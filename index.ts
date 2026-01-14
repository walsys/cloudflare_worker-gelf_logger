interface GelfMessage {
  version: string;
  host: string;
  short_message: string;
  full_message?: string;
  timestamp?: number;
  level?: number;
}

interface LoggerOptions {
  endpoint: string;
  useWebSocket?: boolean;
  wsEndpoint?: string;
  headers?: Record<string, string>;
}

class GelfLogger {
  private endpoint: string;
  private useWebSocket: boolean;
  private wsEndpoint?: string;
  private headers: Record<string, string>;
  private wsConnection: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private messageQueue: GelfMessage[] = [];
  private isProcessingQueue: boolean = false;

  constructor(options: LoggerOptions) {
    this.endpoint = options.endpoint;
    this.useWebSocket = options.useWebSocket || false;
    this.wsEndpoint = options.wsEndpoint;
    this.headers = options.headers || {};
    
    if (this.useWebSocket && !this.wsEndpoint) {
      throw new Error('wsEndpoint is required when useWebSocket is true');
    }
  }

  private async sendHttpLog(message: GelfMessage): Promise<void> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          ...this.headers
        },
        body: JSON.stringify(message)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to send log via HTTP:', error);
      throw error;
    }
  }

  private async sendWebSocketLog(message: GelfMessage): Promise<void> {
    if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
      await this.connectWebSocket();
    }

    try {
      if (!this.wsConnection) {
        throw new Error('WebSocket connection is not available');
      }
      this.wsConnection.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send log via WebSocket:', error);
      // Try to reconnect and resend
      await this.reconnectWebSocket();
      if (!this.wsConnection) {
        throw new Error('WebSocket connection failed to re-establish');
      }
      this.wsConnection.send(JSON.stringify(message));
    }
  }

  private async connectWebSocket(): Promise<void> {
    if (!this.wsEndpoint) {
      throw new Error('WebSocket endpoint not configured');
    }

    return new Promise((resolve, reject) => {
      try {
        // `this.wsEndpoint` is known to be defined above
        this.wsConnection = new WebSocket(this.wsEndpoint as string);
        
        this.wsConnection.onopen = () => {
          this.reconnectAttempts = 0;
          // Process any queued messages after connection is established
          this.processMessageQueue();
          resolve();
        };

        this.wsConnection.onclose = (event: CloseEvent) => {
          const closeDetails = {
            code: event?.code,
            reason: event?.reason || 'No reason provided',
            wasClean: event?.wasClean,
            wsEndpoint: this.wsEndpoint,
            reconnectAttempts: this.reconnectAttempts
          };
          console.log('WebSocket connection closed:', JSON.stringify(closeDetails));
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
              this.connectWebSocket().catch(reject);
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        };

        this.wsConnection.onerror = (event: Event) => {
          const errorDetails = {
            type: (event as ErrorEvent)?.type || 'unknown',
            message: (event as ErrorEvent)?.message || 'No message available',
            error: (event as ErrorEvent)?.error?.message || (event as ErrorEvent)?.error || null,
            wsEndpoint: this.wsEndpoint,
            wsReadyState: this.wsConnection?.readyState,
            wsReadyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.wsConnection?.readyState ?? -1] || 'UNKNOWN',
            reconnectAttempts: this.reconnectAttempts
          };
          console.error('WebSocket error:', JSON.stringify(errorDetails));
          reject(new Error(JSON.stringify(errorDetails)));
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private async reconnectWebSocket(): Promise<void> {
    if (this.wsConnection) {
      try {
        this.wsConnection.close();
      } catch (e) {
        // ignore close errors
      }
      this.wsConnection = null;
    }
    await this.connectWebSocket();
  }

  private async processMessageQueue(): Promise<void> {
    if (this.isProcessingQueue || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        try {
          await this.sendWebSocketLog(message);
        } catch (error) {
          console.error('Failed to send queued message:', error);
          // Re-queue the message for retry
          this.messageQueue.unshift(message);
        }
      }
    }

    this.isProcessingQueue = false;
  }

  private queueWebSocketLog(message: GelfMessage): void {
    this.messageQueue.push(message);
    
    // Only start processing if not already processing
    if (!this.isProcessingQueue) {
      setTimeout(() => this.processMessageQueue(), 0);
    }
  }

  async log(message: string, fullMessage?: string, level: number = 1): Promise<void> {
    const gelfMessage: GelfMessage = {
      version: "1.1",
      host: typeof window !== 'undefined' ? window.location.hostname : "cloudflare-worker",
      short_message: message,
      full_message: fullMessage,
      timestamp: Date.now() / 1000,
      level: level
    };

    try {
      if (this.useWebSocket) {
        this.queueWebSocketLog(gelfMessage);
      } else {
        await this.sendHttpLog(gelfMessage);
      }
    } catch (error) {
      console.error('Failed to send log:', error);
      // Fallback to console.log if sending failså
      console.log('Fallback log:', gelfMessage);
    }
  }

  async info(message: string, fullMessage?: string): Promise<void> {
    await this.log(message, fullMessage, 6);
  }

  async error(message: string, fullMessage?: string): Promise<void> {
    await this.log(message, fullMessage, 3);
  }

  async warn(message: string, fullMessage?: string): Promise<void> {
    await this.log(message, fullMessage, 4);
  }

  async debug(message: string, fullMessage?: string): Promise<void> {
    await this.log(message, fullMessage, 7);
  }
}

export { GelfLogger, GelfMessage, LoggerOptions };
