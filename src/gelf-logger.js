import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * GELF (Graylog Extended Log Format) Logger for Cloudflare Workers
 *
 * Features:
 * - Full GELF 1.1 specification compliance
 * - Non-blocking logging (fire-and-forget)
 * - Graceful failure handling
 * - Support for custom fields
 * - Multiple log levels (Emergency to Debug)
 * - Automatic timestamp generation
 * - Context-aware logging
 * - Optional console method overloading for automatic GELF forwarding
 * - Session ID tracking for multi-instance function message segmentation
 */

export class GELFLogger {
	// AsyncLocalStorage for global context management
	static #storage = new AsyncLocalStorage();

	/**
	 * GELF Log Levels (Syslog severity)
	 * @see https://en.wikipedia.org/wiki/Syslog#Severity_level
	 */
	static LEVELS = {
		EMERGENCY: 0,  // System is unusable
		ALERT: 1,      // Action must be taken immediately
		CRITICAL: 2,   // Critical conditions
		ERROR: 3,      // Error conditions
		WARNING: 4,    // Warning conditions
		NOTICE: 5,     // Normal but significant condition
		INFO: 6,       // Informational messages
		DEBUG: 7       // Debug-level messages
	};

	/**
	 * Create a new GELF Logger instance
	 *
	 * @param {Object} config - Configuration object
	 * @param {Object} config.env - Cloudflare Worker env object (automatically uses env.GELF_LOGGING_URL, env.WORKER_NAME, env.ENVIRONMENT, env.FUNCTION_NAME, env.LOG_SESSION_ID, env.ACCESS_ID, env.ACCESS_SECRET)
	 * @param {Request} config.request - Optional Cloudflare Request object (extracts colo, IP, longitude, latitude from request.cf)
	 * @param {string} config.log_session_id - Optional session ID (UUID) to segment messages. Defaults to env.LOG_SESSION_ID or generates new UUID.
	 * @param {string} config.endpoint - GELF HTTP endpoint URL (optional - will use env.GELF_LOGGING_URL if not provided)
	 * @param {boolean} config.useWebSocket - Use WebSocket instead of HTTP (default: false)
	 * @param {string} config.wsEndpoint - WebSocket endpoint URL (required if useWebSocket is true)
	 * @param {string} config.host - Hostname identifier (default: worker name from env.WORKER_NAME or 'cloudflare-worker')
	 * @param {string} config.facility - Facility/application name (default: 'worker')
	 * @param {Object} config.globalFields - Global custom fields to include in all logs
	 * @param {number} config.minLevel - Minimum log level to send (default: INFO)
	 * @param {boolean} config.consoleLog - Also log to console (default: true)
	 * @param {boolean} config.overloadConsole - Overload global console methods to forward logs to GELF (default: false)
	 * @param {number} config.timeout - Request timeout in ms (default: 5000)
	 * @param {number} config.maxFailedMessages - Maximum failed messages to track (default: 50)
	 */
	constructor(config = {}) {
		// Generate a unique session ID for this logger instance
		// Priority: config.log_session_id > config.env.LOG_SESSION_ID > crypto.randomUUID()
		this.log_session_id = config.log_session_id || config.env?.LOG_SESSION_ID || crypto.randomUUID();

		// WebSocket configuration
		this.useWebSocket = config.useWebSocket || false;
		this.wsEndpoint = config.wsEndpoint;
		this.wsConnection = null;
		this.wsMessageQueue = [];
		this.wsConnecting = false;
		this.wsReconnectAttempts = 0;
		this.wsMaxReconnectAttempts = config.wsMaxReconnectAttempts || 5;

		// Endpoint configuration - automatically use env.GELF_LOGGING_URL if available
		this.endpoint = config.endpoint || config.env?.GELF_LOGGING_URL;

		// Validate endpoint
		if (!this.useWebSocket && (!this.endpoint || typeof this.endpoint !== 'string')) {
			console.error('GELFLogger: No endpoint provided. Set GELF_LOGGING_URL environment variable or pass endpoint in config.');
			this.endpoint = null;
		}

		if (this.useWebSocket && !this.wsEndpoint) {
			console.error('GELFLogger: wsEndpoint is required when useWebSocket is true.');
		}

		// Cloudflare Access credentials for service authentication
		this.accessId = config.env?.ACCESS_ID;
		this.accessSecret = config.env?.ACCESS_SECRET;

		// GELF required fields with Cloudflare Worker defaults
		// host: Use WORKER_NAME from env if available, otherwise fall back to generic name
		this.host = config.host || config.env?.WORKER_NAME || 'cloudflare-worker';
		this.facility = config.facility || 'worker';

		// Extract Cloudflare-specific context from env and request
		this.cfContext = {};

		// Optional: Environment name
		if (config.env?.ENVIRONMENT) {
			this.cfContext.environment = config.env.ENVIRONMENT;
		}

		// Optional: Function name
		if (config.env?.FUNCTION_NAME) {
			this.cfContext.function_name = config.env.FUNCTION_NAME;
		}

		// Optional: Extract request details and Cloudflare context
		if (config.request) {
			// Basic request details
			try {
				const url = new URL(config.request.url);
				this.cfContext.request_path = url.pathname;
				this.cfContext.request_host = url.hostname;
			} catch (e) {
				// Ignore URL parsing errors
			}

			this.cfContext.request_method = config.request.method;

			if (config.request.headers) {
				this.cfContext.request_id = config.request.headers.get('cf-ray') || config.request.headers.get('x-request-id');
				this.cfContext.user_agent = config.request.headers.get('user-agent');

				const clientIp = config.request.headers.get('cf-connecting-ip') || config.request.headers.get('x-forwarded-for');
				if (clientIp) {
					this.cfContext.client_ip = clientIp;
				}
			}

			// Cloudflare specific context
			if (config.request.cf) {
				const cf = config.request.cf;

				// Cloudflare data center (colo)
				if (cf.colo) {
					this.cfContext.colo = cf.colo;
				}

				// Geolocation
				if (cf.longitude !== undefined) {
					this.cfContext.longitude = cf.longitude;
				}
				if (cf.latitude !== undefined) {
					this.cfContext.latitude = cf.latitude;
				}

				// Other useful CF fields
				if (cf.country) this.cfContext.country = cf.country;
				if (cf.city) this.cfContext.city = cf.city;
				if (cf.region) this.cfContext.region = cf.region;
				if (cf.asn) this.cfContext.asn = cf.asn;
				if (cf.asOrganization) this.cfContext.as_organization = cf.asOrganization;
			}
		}

		// Configuration
		this.globalFields = config.globalFields || {};
		this.minLevel = config.minLevel !== undefined ? config.minLevel : GELFLogger.LEVELS.INFO;
		this.consoleLog = config.consoleLog !== undefined ? config.consoleLog : true;
		this.overloadConsole = config.overloadConsole !== undefined ? config.overloadConsole : false; // New config option
		this.timeout = config.timeout || 5000;

		// Internal state (non-blocking promise tracking)
		this.pendingPromises = [];
		this.stats = {
			sent: 0,
			failed: 0,
			skipped: 0
		};

		// Track failed messages for debugging
		this.failedMessages = [];
		this.maxFailedMessages = config.maxFailedMessages || 50; // Limit to prevent memory issues

		// Setup console overloading if enabled
		if (this.overloadConsole) {
			GELFLogger._setupConsoleOverload(this);
		}
	}

	/**
	 * Get the current logger instance from the async context
	 * Useful for accessing the logger without passing it around
	 * 
	 * @returns {GELFLogger|null} The current logger instance or null if not in context
	 */
	static get current() {
		return this.#storage.getStore() || null;
	}

	/**
	 * Run a callback with this logger instance in the async context
	 * 
	 * @param {Function} callback - Function to execute
	 * @returns {*} Result of the callback
	 */
	run(callback) {
		return GELFLogger.#storage.run(this, callback);
	}

	/**
	 * Build a GELF-compliant message
	 *
	 * @private
	 * @param {number} level - Log level (0-7)
	 * @param {string} shortMessage - Short message (required)
	 * @param {string|null} fullMessage - Full message (optional)
	 * @param {Object} customFields - Custom fields (prefixed with _)
	 * @returns {Object} GELF message object
	 */
	_buildGELFMessage(level, shortMessage, fullMessage = null, customFields = {}) {
		// GELF 1.1 specification message
		const message = {
			version: '1.1',                          // GELF spec version
			host: this.host,                         // Required: host identifier
			short_message: String(shortMessage),     // Required: short descriptive message
			timestamp: Date.now() / 1000,            // Unix timestamp with decimals
			level: level,                            // Syslog severity level
			facility: this.facility,                 // Facility/application name
			_log_session_id: this.log_session_id     // Unique session ID for this logger instance
		};

		// Add full message if provided
		if (fullMessage) {
			//attempt to parse fullMessage as string
			if (typeof fullMessage !== 'string') {
				//handle if json
				try {
					fullMessage = JSON.stringify(fullMessage);
				} catch (e) {
					fullMessage = String(fullMessage);
				}
			}
			message.full_message = String(fullMessage);
		}

		// Add Cloudflare context fields (only if they exist)
		for (const [key, value] of Object.entries(this.cfContext)) {
			if (value !== null && value !== undefined) {
				const fieldName = key.startsWith('_') ? key : `_${key}`;
				message[fieldName] = value;
			}
		}

		// Add global custom fields
		for (const [key, value] of Object.entries(this.globalFields)) {
			const fieldName = key.startsWith('_') ? key : `_${key}`;
			message[fieldName] = value;
		}

		// Add custom fields (ensure _ prefix)
		for (const [key, value] of Object.entries(customFields)) {
			// Skip reserved GELF fields
			if (['id', 'timestamp', 'version', 'level', 'host', 'short_message', 'full_message'].includes(key)) {
				continue;
			}

			const fieldName = key.startsWith('_') ? key : `_${key}`;

			// Handle different data types
			if (value === null || value === undefined) {
				message[fieldName] = null;
			} else if (typeof value === 'object') {
				// Serialize objects as JSON strings
				try {
					message[fieldName] = JSON.stringify(value);
				} catch (e) {
					message[fieldName] = String(value);
				}
			} else {
				message[fieldName] = value;
			}
		}

		return message;
	}

	/**
	 * Send a log message to GELF endpoint (non-blocking)
	 *
	 * @private
	 * @param {Object} gelfMessage - GELF message object
	 */
	_send(gelfMessage) {
		// Check if using WebSocket
		if (this.useWebSocket) {
			return this._sendWebSocket(gelfMessage);
		}

		// Skip sending if no endpoint configured
		if (!this.endpoint) {
			this.stats.failed++;
			this._logFailure({
				message: gelfMessage,
				reason: 'no_endpoint',
				error: 'No GELF endpoint configured',
				timestamp: Date.now()
			});
			return;
		}

		// Create abort controller for timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		// Build headers object
		const headers = {
			'Content-Type': 'application/json',
			'Accept': 'application/json'
		};

		// Add Cloudflare Access headers if credentials are configured
		if (this.accessId && this.accessSecret) {
			headers['CF-Access-Client-Id'] = this.accessId;
			headers['CF-Access-Client-Secret'] = this.accessSecret;
		}

		// Create non-blocking promise
		const promise = fetch(this.endpoint, {
			method: 'POST',
			headers: headers,
			body: JSON.stringify(gelfMessage),
			signal: controller.signal
		})
			.then(response => {
				clearTimeout(timeoutId);
				if (response.ok) {
					this.stats.sent++;
				} else {
					this.stats.failed++;

					// Log failure details
					this._logFailure({
						message: gelfMessage,
						reason: 'http_error',
						error: `HTTP ${response.status} ${response.statusText}`,
						endpoint: this.endpoint,
						timestamp: Date.now()
					});

					// Console warning
					if (this.consoleLog && !this.overloadConsole) { // Only log if not overloading console
						console.warn(`GELFLogger: HTTP ${response.status} from ${this.endpoint}`, {
							short_message: gelfMessage.short_message,
							level: gelfMessage.level
						});
					}
				}
				return response;
			})
			.catch(error => {
				clearTimeout(timeoutId);
				this.stats.failed++;

				// Determine failure reason
				const reason = error.name === 'AbortError' ? 'timeout' : 'network_error';
				const errorMessage = error.name === 'AbortError'
					? `Request timeout after ${this.timeout}ms`
					: error.message;

				// Log failure details
				this._logFailure({
					message: gelfMessage,
					reason: reason,
					error: errorMessage,
					endpoint: this.endpoint,
					timestamp: Date.now()
				});

				// Console warning (skip timeout warnings in quiet mode)
				if (this.consoleLog && !this.overloadConsole && error.name !== 'AbortError') { // Only log if not overloading console
					console.warn('GELFLogger: Send failed:', errorMessage, {
						short_message: gelfMessage.short_message,
						level: gelfMessage.level,
						endpoint: this.endpoint
					});
				}
			});

		// Track promise but don't await it (non-blocking)
		this.pendingPromises.push(promise);

		// Clean up resolved promises periodically
		if (this.pendingPromises.length > 100) {
			this._cleanupPromises();
		}
	}

	/**
	 * Send a log message via WebSocket (non-blocking)
	 *
	 * @private
	 * @param {Object} gelfMessage - GELF message object
	 */
	_sendWebSocket(gelfMessage) {
		// Skip sending if no WebSocket endpoint configured
		if (!this.wsEndpoint) {
			this.stats.failed++;
			this._logFailure({
				message: gelfMessage,
				reason: 'no_ws_endpoint',
				error: 'No WebSocket endpoint configured',
				timestamp: Date.now()
			});
			return;
		}

		// Queue message
		this.wsMessageQueue.push(gelfMessage);

		// Process queue if connection is ready
		if (this.wsConnection && this.wsConnection.readyState === 1) { // OPEN
			this._processWebSocketQueue();
		} else if (!this.wsConnection || this.wsConnection.readyState === 3) { // CLOSED
			// Attempt to connect
			this._connectWebSocket();
		}
	}

	/**
	 * Connect to WebSocket endpoint
	 *
	 * @private
	 */
	_connectWebSocket() {
		if (this.wsConnecting) {
			return; // Already attempting to connect
		}

		this.wsConnecting = true;

		try {
			this.wsConnection = new WebSocket(this.wsEndpoint);

					this.wsConnection.onopen = () => {
				this.wsConnecting = false;
				this.wsReconnectAttempts = 0;
				if (this.consoleLog && !this.overloadConsole) {
					console.log('GELFLogger: WebSocket connected');
				}
						// Authenticate over WebSocket if credentials provided
						this.wsAuthenticated = false;
						if (this.accessId && this.accessSecret) {
							try {
								const authMsg = {
									type: 'auth',
									access_id: this.accessId,
									access_secret: this.accessSecret,
									log_session_id: this.log_session_id
								};
								// Send auth message immediately; server should respond with ack
								this.wsConnection.send(JSON.stringify(authMsg));
								// Set a timeout for authentication
								if (!this.wsAuthTimeout) this.wsAuthTimeout = config?.wsAuthTimeout || 5000;
								this._wsAuthTimer = setTimeout(() => {
									if (!this.wsAuthenticated) {
										if (this.consoleLog && !this.overloadConsole) console.warn('GELFLogger: WebSocket auth timeout');
										// Still attempt to process queue (server may accept messages without auth ack)
										this._processWebSocketQueue();
									}
								}, this.wsAuthTimeout);
							} catch (e) {
								// If send fails, still attempt to process queue
								this._processWebSocketQueue();
							}
						} else {
							// No credentials — process queue immediately
							this._processWebSocketQueue();
						}
			};

			this.wsConnection.onclose = () => {
				this.wsConnecting = false;
				if (this.consoleLog && !this.overloadConsole) {
					console.log('GELFLogger: WebSocket closed');
				}
				// Attempt reconnection with exponential backoff
				if (this.wsReconnectAttempts < this.wsMaxReconnectAttempts) {
					this.wsReconnectAttempts++;
					const delay = Math.min(1000 * Math.pow(2, this.wsReconnectAttempts), 30000);
					setTimeout(() => this._connectWebSocket(), delay);
				}
			};

			this.wsConnection.onerror = (error) => {
				this.wsConnecting = false;
				if (this.consoleLog && !this.overloadConsole) {
					console.error('GELFLogger: WebSocket error:', error);
				}
			};
		} catch (error) {
			this.wsConnecting = false;
			if (this.consoleLog && !this.overloadConsole) {
				console.error('GELFLogger: WebSocket connection failed:', error);
			}
		}
	}

	/**
	 * Process queued WebSocket messages
	 *
	 * @private
	 */
	_processWebSocketQueue() {
		if (!this.wsConnection || this.wsConnection.readyState !== 1) {
			return; // Not connected
		}

		while (this.wsMessageQueue.length > 0) {
			const message = this.wsMessageQueue.shift();
			try {
				this.wsConnection.send(JSON.stringify(message));
				this.stats.sent++;
			} catch (error) {
				this.stats.failed++;
				this._logFailure({
					message: message,
					reason: 'ws_send_error',
					error: error.message,
					timestamp: Date.now()
				});
				// Re-queue message for retry
				this.wsMessageQueue.unshift(message);
				break;
			}
		}
	}

	/**
	 * Log a failed message for debugging
	 *
	 * @private
	 * @param {Object} failureInfo - Information about the failure
	 */
	_logFailure(failureInfo) {
		// Add to failed messages array
		this.failedMessages.push(failureInfo);

		// Trim array to max size (keep most recent)
		if (this.failedMessages.length > this.maxFailedMessages) {
			this.failedMessages.shift();
		}

		// Also log to console in verbose mode
		if (this.consoleLog && !this.overloadConsole) { // Only log if not overloading console
			console.error('GELFLogger: Failed to emit log', {
				reason: failureInfo.reason,
				error: failureInfo.error,
				short_message: failureInfo.message.short_message,
				level: failureInfo.message.level,
				timestamp: new Date(failureInfo.timestamp).toISOString()
			});
		}
	}

	/**
	 * Clean up resolved promises from tracking array
	 *
	 * @private
	 */
	_cleanupPromises() {
		// Keep only pending promises
		this.pendingPromises = this.pendingPromises.filter(p => {
			let isPending = true;
			p.then(() => { isPending = false; }).catch(() => { isPending = false; });
			return isPending;
		});
	}

	/**
	 * Core logging method
	 *
	 * @private
	 * @param {number} level - Log level
	 * @param {string} shortMessage - Short message
	 * @param {string|null} fullMessage - Full message
	 * @param {Object} customFields - Custom fields
	 */
	_log(level, shortMessage, fullMessage = null, customFields = {}) {
		try {
			// Check if level should be logged
			if (level > this.minLevel) {
				this.stats.skipped++;
				return;
			}

			// Build GELF message
			const gelfMessage = this._buildGELFMessage(level, shortMessage, fullMessage, customFields);

			// Send to GELF endpoint (non-blocking)
			this._send(gelfMessage);

			// Also log to console if enabled and not overloading console
			if (this.consoleLog && !this.overloadConsole) {
				const levelName = Object.keys(GELFLogger.LEVELS).find(
					key => GELFLogger.LEVELS[key] === level
				);
				let logMessage = `[${levelName}]`;
				//try and json parse shortMessage
				try {
					JSON.parse(shortMessage);
					logMessage += ` ${JSON.stringify(shortMessage)}`;
				} catch (e) {
					logMessage += ` ${shortMessage}`;
				}
				//add fullMessage if exists
				if (fullMessage) {
					try {
						JSON.parse(fullMessage);
						fullMessage = JSON.stringify(fullMessage);
						logMessage += `\n${fullMessage}`;
					} catch (e) {
						logMessage += `\n${fullMessage}`;
					}
				}
				console.log(logMessage);
			}
		} catch (error) {
			// Graceful failure - never interrupt main thread
			this.stats.failed++;
			if (this.consoleLog && !this.overloadConsole) { // Only log if not overloading console
				console.error('GELFLogger: Internal error:', error.message);
			}
		}
	}

	// ==================== Public Logging Methods ====================

	/**
	 * Log an emergency message (level 0)
	 * System is unusable
	 */
	emergency(shortMessage, fullMessage = null, customFields = {}) {
		this._log(GELFLogger.LEVELS.EMERGENCY, shortMessage, fullMessage, customFields);
	}

	/**
	 * Log an alert message (level 1)
	 * Action must be taken immediately
	 */
	alert(shortMessage, fullMessage = null, customFields = {}) {
		this._log(GELFLogger.LEVELS.ALERT, shortMessage, fullMessage, customFields);
	}

	/**
	 * Log a critical message (level 2)
	 * Critical conditions
	 */
	critical(shortMessage, fullMessage = null, customFields = {}) {
		this._log(GELFLogger.LEVELS.CRITICAL, shortMessage, fullMessage, customFields);
	}

	/**
	 * Log an error message (level 3)
	 * Error conditions
	 */
	error(shortMessage, fullMessage = null, customFields = {}) {
		this._log(GELFLogger.LEVELS.ERROR, shortMessage, fullMessage, customFields);
	}

	/**
	 * Log a warning message (level 4)
	 * Warning conditions
	 */
	warning(shortMessage, fullMessage = null, customFields = {}) {
		this._log(GELFLogger.LEVELS.WARNING, shortMessage, fullMessage, customFields);
	}

	// Alias for warning
	warn(shortMessage, fullMessage = null, customFields = {}) {
		this.warning(shortMessage, fullMessage, customFields);
	}

	/**
	 * Log a notice message (level 5)
	 * Normal but significant condition
	 */
	notice(shortMessage, fullMessage = null, customFields = {}) {
		this._log(GELFLogger.LEVELS.NOTICE, shortMessage, fullMessage, customFields);
	}

	/**
	 * Log an info message (level 6)
	 * Informational messages
	 */
	info(shortMessage, fullMessage = null, customFields = {}) {
		this._log(GELFLogger.LEVELS.INFO, shortMessage, fullMessage, customFields);
	}

	// Alias for info
	log(shortMessage, fullMessage = null, customFields = {}) {
		this.info(shortMessage, fullMessage, customFields);
	}

	/**
	 * Log a debug message (level 7)
	 * Debug-level messages
	 */
	debug(shortMessage, fullMessage = null, customFields = {}) {
		this._log(GELFLogger.LEVELS.DEBUG, shortMessage, fullMessage, customFields);
	}

	/**
	 * Log an exception with stack trace
	 *
	 * @param {Error} error - Error object
	 * @param {Object} customFields - Additional custom fields
	 */
	exception(error, customFields = {}) {
		const fields = {
			...customFields,
			exception_type: error.name,
			exception_message: error.message,
			exception_stack: error.stack
		};

		this._log(
			GELFLogger.LEVELS.ERROR,
			error.message,
			error.stack,
			fields
		);
	}

	/**
	 * Create a child logger with additional context
	 *
	 * @param {Object} contextFields - Context fields to add to all logs
	 * @returns {GELFLogger} New logger instance with context
	 */
	child(contextFields = {}) {
		const childLogger = new GELFLogger({
			endpoint: this.endpoint,
			useWebSocket: this.useWebSocket,
			wsEndpoint: this.wsEndpoint,
			host: this.host,
			facility: this.facility,
			globalFields: { ...this.globalFields, ...contextFields },
			minLevel: this.minLevel,
			consoleLog: this.consoleLog,
			overloadConsole: this.overloadConsole,
			timeout: this.timeout
		});
		// Preserve Cloudflare context, session ID, and access credentials in child logger
		childLogger.cfContext = { ...this.cfContext };
		childLogger.log_session_id = this.log_session_id;
		childLogger.accessId = this.accessId;
		childLogger.accessSecret = this.accessSecret;
		// Share WebSocket connection with parent
		if (this.useWebSocket) {
			childLogger.wsConnection = this.wsConnection;
			childLogger.wsMessageQueue = this.wsMessageQueue;
		}
		return childLogger;
	}

	/**
	 * Wait for all pending log messages to complete
	 * Useful for ensuring logs are sent before worker termination
	 *
	 * @returns {Promise<void>}
	 */
	async flush() {
		try {
			await Promise.allSettled(this.pendingPromises);
			this.pendingPromises = [];
		} catch (error) {
			// Silent fail on flush errors
			if (this.consoleLog && !this.overloadConsole) { // Only log if not overloading console
				console.warn('GELFLogger: Flush error:', error.message);
			}
		}
	}

	/**
	 * Get logger statistics
	 *
	 * @returns {Object} Stats object with sent, failed, and skipped counts
	 */
	getStats() {
		return {
			...this.stats,
			failedMessagesCount: this.failedMessages.length
		};
	}

	/**
	 * Get failed messages for debugging
	 *
	 * @param {number} limit - Maximum number of failed messages to return (default: all)
	 * @returns {Array} Array of failed message objects
	 */
	getFailedMessages(limit = null) {
		const messages = [...this.failedMessages];
		return limit ? messages.slice(-limit) : messages;
	}

	/**
	 * Get a summary of failure reasons
	 *
	 * @returns {Object} Object with failure counts by reason
	 */
	getFailureSummary() {
		const summary = {
			no_endpoint: 0,
			http_error: 0,
			timeout: 0,
			network_error: 0,
			other: 0
		};

		this.failedMessages.forEach(failure => {
			if (summary.hasOwnProperty(failure.reason)) {
				summary[failure.reason]++;
			} else {
				summary.other++;
			}
		});

		return summary;
	}

	/**
	 * Clear failed messages history
	 */
	clearFailedMessages() {
		this.failedMessages = [];
	}

	/**
	 * Reset logger statistics
	 */
	resetStats() {
		this.stats = {
			sent: 0,
			failed: 0,
			skipped: 0
		};
		this.failedMessages = [];
	}

	/**
	 * Overload console methods to forward logs to GELF.
	 * @param {GELFLogger} logger - The GELFLogger instance.
	 * @private
	 */
	static _setupConsoleOverload(logger) {
		// Store original console methods to allow calling them
		const originalConsole = {};
		const consoleMethods = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'assert'];

		consoleMethods.forEach(methodName => {
			if (typeof console[methodName] === 'function') {
				originalConsole[methodName] = console[methodName];

				console[methodName] = (...args) => {
					// Call original console method first
					originalConsole[methodName](...args);

					// Determine GELF level
					let level;
					switch (methodName) {
						case 'error':
						case 'assert':
							level = GELFLogger.LEVELS.ERROR;
							break;
						case 'warn':
							level = GELFLogger.LEVELS.WARNING;
							break;
						case 'info':
						case 'log':
						case 'dir':
							level = GELFLogger.LEVELS.INFO;
							break;
						case 'debug':
						case 'trace':
							level = GELFLogger.LEVELS.DEBUG;
							break;
						default:
							level = GELFLogger.LEVELS.INFO;
					}

					// Format message for GELF
					let shortMessage = '';
					let fullMessage = null;
					let customFields = {};

					// For assert, the first argument is the condition, the rest are messages
					if (methodName === 'assert' && !args[0]) { // Only log if assertion fails
						shortMessage = `Assertion Failed: ${String(args[1] || 'no message')}`;
						if (args.length > 2) {
							fullMessage = args.slice(2).map(arg => {
								if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg);
								return String(arg);
							}).join(' ');
						}
						customFields = { ...customFields, _console_assert: true };
					} else if (methodName !== 'assert') { // Normal logging for other methods
						if (args.length > 0) {
							// First argument is usually the main message
							shortMessage = String(args[0]);

							// If there are more arguments, stringify them for fullMessage or custom fields
							if (args.length > 1) {
								const remainingArgs = args.slice(1);
								// Attempt to find an object for custom fields
								const lastArg = remainingArgs[remainingArgs.length - 1];
								if (typeof lastArg === 'object' && lastArg !== null && !Array.isArray(lastArg) && !(lastArg instanceof Error)) {
									customFields = lastArg;
									fullMessage = remainingArgs.slice(0, -1).map(arg => {
										if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg);
										return String(arg);
									}).join(' ');
								} else {
									fullMessage = remainingArgs.map(arg => {
										if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg);
										return String(arg);
									}).join(' ');
								}
							}
						}
					} else { // If assert passes, don't log to GELF
						return;
					}


					// Handle trace specifically to include stack
					if (methodName === 'trace') {
						const error = new Error('Console Trace');
						fullMessage = fullMessage ? `${fullMessage}\n${error.stack}` : error.stack;
						customFields = { ...customFields, _console_trace: true };
					}

					// Call the GELF logger
					logger._log(level, shortMessage, fullMessage, customFields);
				};

				this.wsConnection.onmessage = (event) => {
					try {
						const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
						if (data && data.type === 'auth_ack') {
							this.wsAuthenticated = true;
							if (this._wsAuthTimer) {
								clearTimeout(this._wsAuthTimer);
								this._wsAuthTimer = null;
							}
							if (this.consoleLog && !this.overloadConsole) console.log('GELFLogger: WebSocket authenticated');
							// Now that we're authenticated, process the queue
							this._processWebSocketQueue();
						}
					} catch (e) {
						// Non-JSON or unrelated message — ignore
					}
				};
			}
		});

		// Store original console methods for potential restoration or internal use
		logger._originalConsole = originalConsole;
	}
}
