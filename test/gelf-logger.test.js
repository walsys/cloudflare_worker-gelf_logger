import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GELFLogger } from '../src/gelf-logger.js';

describe('GELFLogger', () => {
	let mockEnv;
	let mockRequest;
	let fetchSpy;

	beforeEach(() => {
		// Setup mock environment
		mockEnv = {
			GELF_LOGGING_URL: 'http://test-graylog.com/gelf',
			WORKER_NAME: 'test-worker',
			ENVIRONMENT: 'test',
			FUNCTION_NAME: 'test-function',
		};

		// Setup mock request with Cloudflare context
		mockRequest = {
			headers: new Headers({
				'cf-connecting-ip': '203.0.113.42',
			}),
			cf: {
				colo: 'SFO',
				longitude: -122.4194,
				latitude: 37.7749,
			},
		};

		// Mock fetch globally
		fetchSpy = vi.fn(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				statusText: 'OK',
			})
		);
		global.fetch = fetchSpy;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Constructor', () => {
		it('should create logger with env object', () => {
			const logger = new GELFLogger({ env: mockEnv });

			expect(logger.endpoint).toBe('http://test-graylog.com/gelf');
			expect(logger.host).toBe('test-worker');
			expect(logger.facility).toBe('worker');
		});

		it('should extract Cloudflare context from request', () => {
			const logger = new GELFLogger({ env: mockEnv, request: mockRequest });

			expect(logger.cfContext.colo).toBe('SFO');
			expect(logger.cfContext.client_ip).toBe('203.0.113.42');
			expect(logger.cfContext.longitude).toBe(-122.4194);
			expect(logger.cfContext.latitude).toBe(37.7749);
			expect(logger.cfContext.environment).toBe('test');
			expect(logger.cfContext.function_name).toBe('test-function');
		});

		it('should use default values when env vars not present', () => {
			const logger = new GELFLogger({ env: {} });

			expect(logger.host).toBe('cloudflare-worker');
			expect(logger.facility).toBe('worker');
		});

		it('should handle missing endpoint gracefully', () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const logger = new GELFLogger({ env: {} });

			expect(logger.endpoint).toBe(null);
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('No endpoint provided')
			);

			consoleSpy.mockRestore();
		});

		it('should accept custom configuration', () => {
			const logger = new GELFLogger({
				env: mockEnv,
				host: 'custom-host',
				facility: 'custom-facility',
				minLevel: GELFLogger.LEVELS.DEBUG,
				timeout: 10000,
			});

			expect(logger.host).toBe('custom-host');
			expect(logger.facility).toBe('custom-facility');
			expect(logger.minLevel).toBe(GELFLogger.LEVELS.DEBUG);
			expect(logger.timeout).toBe(10000);
		});
	});

	describe('Log Levels', () => {
		let logger;

		beforeEach(() => {
			logger = new GELFLogger({
				env: mockEnv,
				consoleLog: false,
				minLevel: GELFLogger.LEVELS.DEBUG, // Enable all log levels including debug
			});
		});

		it('should log emergency message (level 0)', async () => {
			logger.emergency('System down');
			await logger.flush();

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(0);
			expect(body.short_message).toBe('System down');
		});

		it('should log alert message (level 1)', async () => {
			logger.alert('Immediate action required');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(1);
		});

		it('should log critical message (level 2)', async () => {
			logger.critical('Critical failure');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(2);
		});

		it('should log error message (level 3)', async () => {
			logger.error('Error occurred');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(3);
		});

		it('should log warning message (level 4)', async () => {
			logger.warning('Warning message');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(4);
		});

		it('should log warning with warn alias', async () => {
			logger.warn('Warning via alias');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(4);
			expect(body.short_message).toBe('Warning via alias');
		});

		it('should log notice message (level 5)', async () => {
			logger.notice('Notice message');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(5);
		});

		it('should log info message (level 6)', async () => {
			logger.info('Info message');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(6);
		});

		it('should log info with log alias', async () => {
			logger.log('Info via alias');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(6);
			expect(body.short_message).toBe('Info via alias');
		});

		it('should log debug message (level 7)', async () => {
			logger.debug('Debug message');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(7);
		});
	});

	describe('Message Format', () => {
		let logger;

		beforeEach(() => {
			logger = new GELFLogger({ env: mockEnv, consoleLog: false });
		});

		it('should create GELF 1.1 compliant message', async () => {
			logger.info('Test message');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);

			expect(body.version).toBe('1.1');
			expect(body.host).toBe('test-worker');
			expect(body.short_message).toBe('Test message');
			expect(body.timestamp).toBeTypeOf('number');
			expect(body.level).toBe(6);
			expect(body.facility).toBe('worker');
		});

		it('should include full message when provided', async () => {
			logger.info('Short', 'This is a longer detailed message');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.short_message).toBe('Short');
			expect(body.full_message).toBe('This is a longer detailed message');
		});

		it('should include custom fields with underscore prefix', async () => {
			logger.info('Test', null, {
				user_id: '12345',
				request_id: 'abc-123',
			});
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body._user_id).toBe('12345');
			expect(body._request_id).toBe('abc-123');
		});

		it('should serialize object custom fields as JSON', async () => {
			logger.info('Test', null, {
				metadata: { foo: 'bar', count: 42 },
			});
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body._metadata).toBe('{"foo":"bar","count":42}');
		});

		it('should include Cloudflare context fields', async () => {
			const loggerWithContext = new GELFLogger({
				env: mockEnv,
				request: mockRequest,
				consoleLog: false,
			});

			loggerWithContext.info('Test message');
			await loggerWithContext.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body._colo).toBe('SFO');
			expect(body._client_ip).toBe('203.0.113.42');
			expect(body._longitude).toBe(-122.4194);
			expect(body._latitude).toBe(37.7749);
			expect(body._environment).toBe('test');
			expect(body._function_name).toBe('test-function');
		});
	});

	describe('Exception Logging', () => {
		let logger;

		beforeEach(() => {
			logger = new GELFLogger({ env: mockEnv, consoleLog: false });
		});

		it('should log exception with stack trace', async () => {
			const error = new Error('Test error');
			logger.exception(error);
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body.level).toBe(3); // ERROR level
			expect(body.short_message).toBe('Test error');
			expect(body.full_message).toBe(error.stack);
			expect(body._exception_type).toBe('Error');
			expect(body._exception_message).toBe('Test error');
			expect(body._exception_stack).toBe(error.stack);
		});

		it('should include custom fields with exception', async () => {
			const error = new Error('Test error');
			logger.exception(error, { context: 'test', user_id: '123' });
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body._context).toBe('test');
			expect(body._user_id).toBe('123');
		});
	});

	describe('Child Logger', () => {
		let logger;

		beforeEach(() => {
			logger = new GELFLogger({
				env: mockEnv,
				request: mockRequest,
				consoleLog: false,
			});
		});

		it('should create child logger with additional context', async () => {
			const childLogger = logger.child({ request_id: 'req-123' });

			childLogger.info('Child log');
			await childLogger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body._request_id).toBe('req-123');
		});

		it('should preserve parent Cloudflare context', async () => {
			const childLogger = logger.child({ request_id: 'req-123' });

			childLogger.info('Child log');
			await childLogger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body._colo).toBe('SFO');
			expect(body._client_ip).toBe('203.0.113.42');
			expect(body._environment).toBe('test');
		});

		it('should inherit parent configuration', () => {
			const childLogger = logger.child({ extra: 'field' });

			expect(childLogger.endpoint).toBe(logger.endpoint);
			expect(childLogger.host).toBe(logger.host);
			expect(childLogger.facility).toBe(logger.facility);
			expect(childLogger.minLevel).toBe(logger.minLevel);
		});
	});

	describe('Log Level Filtering', () => {
		it('should skip logs below minimum level', async () => {
			const logger = new GELFLogger({
				env: mockEnv,
				minLevel: GELFLogger.LEVELS.WARNING,
				consoleLog: false,
			});

			logger.debug('Debug message');
			logger.info('Info message');
			logger.warning('Warning message');
			logger.error('Error message');

			await logger.flush();

			// Only WARNING and ERROR should be sent
			expect(fetchSpy).toHaveBeenCalledTimes(2);

			const stats = logger.getStats();
			expect(stats.sent).toBe(2);
			expect(stats.skipped).toBe(2);
		});

		it('should log all levels when minLevel is DEBUG', async () => {
			const logger = new GELFLogger({
				env: mockEnv,
				minLevel: GELFLogger.LEVELS.DEBUG,
				consoleLog: false,
			});

			logger.debug('Debug');
			logger.info('Info');
			logger.warning('Warning');
			logger.error('Error');

			await logger.flush();

			expect(fetchSpy).toHaveBeenCalledTimes(4);
		});
	});

	describe('Statistics', () => {
		let logger;

		beforeEach(() => {
			logger = new GELFLogger({ env: mockEnv, consoleLog: false });
		});

		it('should track sent messages', async () => {
			logger.info('Message 1');
			logger.info('Message 2');
			logger.info('Message 3');

			await logger.flush();

			const stats = logger.getStats();
			expect(stats.sent).toBe(3);
			expect(stats.failed).toBe(0);
		});

		it('should track skipped messages', async () => {
			const logger = new GELFLogger({
				env: mockEnv,
				minLevel: GELFLogger.LEVELS.WARNING,
				consoleLog: false,
			});

			logger.debug('Skipped');
			logger.info('Skipped');
			logger.warning('Sent');

			await logger.flush();

			const stats = logger.getStats();
			expect(stats.skipped).toBe(2);
			expect(stats.sent).toBe(1);
		});

		it('should track failed messages', async () => {
			fetchSpy.mockImplementation(() =>
				Promise.resolve({
					ok: false,
					status: 500,
					statusText: 'Internal Server Error',
				})
			);

			logger.info('Failed message');
			await logger.flush();

			const stats = logger.getStats();
			expect(stats.failed).toBe(1);
			expect(stats.sent).toBe(0);
		});

		it('should reset statistics', async () => {
			logger.info('Message');
			await logger.flush();

			logger.resetStats();

			const stats = logger.getStats();
			expect(stats.sent).toBe(0);
			expect(stats.failed).toBe(0);
			expect(stats.skipped).toBe(0);
		});
	});

	describe('Failed Messages', () => {
		let logger;

		beforeEach(() => {
			logger = new GELFLogger({ env: mockEnv, consoleLog: false });
		});

		it('should track failed messages', async () => {
			fetchSpy.mockImplementation(() =>
				Promise.resolve({
					ok: false,
					status: 500,
					statusText: 'Internal Server Error',
				})
			);

			logger.info('Failed message');
			await logger.flush();

			const failed = logger.getFailedMessages();
			expect(failed).toHaveLength(1);
			expect(failed[0].reason).toBe('http_error');
			expect(failed[0].message.short_message).toBe('Failed message');
		});

		it('should track network errors', async () => {
			fetchSpy.mockRejectedValue(new Error('Network error'));

			logger.info('Network error message');
			await logger.flush();

			const failed = logger.getFailedMessages();
			expect(failed).toHaveLength(1);
			expect(failed[0].reason).toBe('network_error');
		});

		it('should provide failure summary', async () => {
			fetchSpy
				.mockResolvedValueOnce({ ok: false, status: 500 })
				.mockRejectedValueOnce(new Error('Network error'));

			logger.info('HTTP error');
			logger.info('Network error');
			await logger.flush();

			const summary = logger.getFailureSummary();
			expect(summary.http_error).toBe(1);
			expect(summary.network_error).toBe(1);
		});

		it('should clear failed messages', async () => {
			fetchSpy.mockResolvedValue({ ok: false, status: 500 });

			logger.info('Failed');
			await logger.flush();

			logger.clearFailedMessages();

			const failed = logger.getFailedMessages();
			expect(failed).toHaveLength(0);
		});
	});

	describe('Error Handling', () => {
		it('should handle missing endpoint gracefully', async () => {
			const logger = new GELFLogger({ env: {}, consoleLog: false });

			logger.info('Test message');
			await logger.flush();

			const stats = logger.getStats();
			expect(stats.failed).toBe(1);
			expect(stats.sent).toBe(0);

			const failed = logger.getFailedMessages();
			expect(failed[0].reason).toBe('no_endpoint');
		});

		it('should handle timeout', async () => {
			const logger = new GELFLogger({
				env: mockEnv,
				timeout: 10,
				consoleLog: false,
			});

			fetchSpy.mockImplementation(
				() =>
					new Promise((_, reject) => {
						setTimeout(() => reject({ name: 'AbortError' }), 100);
					})
			);

			logger.info('Timeout message');
			await logger.flush();

			const failed = logger.getFailedMessages();
			expect(failed[0].reason).toBe('timeout');
		});

		it('should not crash on internal errors', async () => {
			const logger = new GELFLogger({ env: mockEnv, consoleLog: false });

			// Mock _buildGELFMessage to throw
			const originalBuild = logger._buildGELFMessage;
			logger._buildGELFMessage = () => {
				throw new Error('Internal error');
			};

			expect(() => logger.info('Test')).not.toThrow();

			logger._buildGELFMessage = originalBuild;
		});
	});

	describe('Global Fields', () => {
		it('should include global fields in all messages', async () => {
			const logger = new GELFLogger({
				env: mockEnv,
				globalFields: {
					app_version: '1.0.0',
					environment: 'test',
				},
				consoleLog: false,
			});

			logger.info('Test message');
			await logger.flush();

			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body._app_version).toBe('1.0.0');
			expect(body._environment).toBe('test');
		});
	});

	describe('Console Logging', () => {
		it('should log to console when enabled', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const logger = new GELFLogger({
				env: mockEnv,
				consoleLog: true,
			});

			logger.info('Console test');

			expect(consoleSpy).toHaveBeenCalledWith('[INFO] Console test');
			consoleSpy.mockRestore();
		});

		it('should not log to console when disabled', () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

			const logger = new GELFLogger({
				env: mockEnv,
				consoleLog: false,
			});

			logger.info('No console');

			expect(consoleSpy).not.toHaveBeenCalled();
			consoleSpy.mockRestore();
		});
	});

	describe('Session ID', () => {
		it('should use provided log_session_id', () => {
			const sessionId = 'custom-session-id';
			const logger = new GELFLogger({ env: mockEnv, log_session_id: sessionId });
			expect(logger.log_session_id).toBe(sessionId);

			// Verify it's sent in the message
			logger.info('test message');
			expect(fetchSpy).toHaveBeenCalled();
			const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
			expect(body._log_session_id).toBe(sessionId);
		});

		it('should use env.LOG_SESSION_ID if provided', () => {
			const sessionId = 'env-session-id';
			const env = { ...mockEnv, LOG_SESSION_ID: sessionId };
			const logger = new GELFLogger({ env });
			expect(logger.log_session_id).toBe(sessionId);
		});

		it('should generate UUID if no session ID provided', () => {
			const logger = new GELFLogger({ env: mockEnv });
			expect(logger.log_session_id).toBeDefined();
			expect(logger.log_session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		});
	});

	describe('Request Details', () => {
		it('should extract extended request details', () => {
			const extendedRequest = {
				url: 'https://example.com/api/users?id=123',
				method: 'POST',
				headers: new Headers({
					'cf-connecting-ip': '203.0.113.42',
					'user-agent': 'Mozilla/5.0',
					'cf-ray': 'ray-id-12345'
				}),
				cf: {
					colo: 'SFO',
					longitude: -122.4194,
					latitude: 37.7749,
					country: 'US',
					city: 'San Francisco'
				},
			};
			const logger = new GELFLogger({ env: mockEnv, request: extendedRequest });

			expect(logger.cfContext.request_path).toBe('/api/users');
			expect(logger.cfContext.request_host).toBe('example.com');
			expect(logger.cfContext.request_method).toBe('POST');
			expect(logger.cfContext.request_id).toBe('ray-id-12345');
			expect(logger.cfContext.user_agent).toBe('Mozilla/5.0');
			expect(logger.cfContext.client_ip).toBe('203.0.113.42');
			expect(logger.cfContext.country).toBe('US');
			expect(logger.cfContext.city).toBe('San Francisco');
		});

		it('should handle missing request headers gracefully', () => {
			const minimalRequest = {
				url: 'https://example.com',
				method: 'GET',
				headers: new Headers(),
				cf: {}
			};
			const logger = new GELFLogger({ env: mockEnv, request: minimalRequest });
			expect(logger.cfContext.request_path).toBe('/');
			expect(logger.cfContext.request_method).toBe('GET');
			expect(logger.cfContext.client_ip).toBeUndefined();
		});
	});
});
