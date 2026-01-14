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
      this.wsConnection.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send log via WebSocket:', error);
      // Try to reconnect and resend
      await this.reconnectWebSocket();
      this.wsConnection.send(JSON.stringify(message));
    }
  }

  private async connectWebSocket(): Promise<void> {
    if (!this.wsEndpoint) {
      throw new Error('WebSocket endpoint not configured');
    }

    return new Promise((resolve, reject) => {
      try {
        this.wsConnection = new WebSocket(this.wsEndpoint);
        
        this.wsConnection.onopen = () => {
          this.reconnectAttempts = 0;
          // Process any queued messages after connection is established
          this.processMessageQueue();
          resolve();
        };

        this.wsConnection.onclose = () => {
          console.log('WebSocket connection closed');
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
              this.connectWebSocket().catch(reject);
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        };

        this.wsConnection.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private async reconnectWebSocket(): Promise<void> {
    if (this.wsConnection) {
      this.wsConnection.close();
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
