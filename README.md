# GELF Logger for Cloudflare Workers

A production-ready GELF (Graylog Extended Log Format) logger specifically designed for Cloudflare Workers. Non-blocking, lightweight, and packed with Cloudflare-specific integrations.

[![npm version](https://badge.fury.io/js/@walsys%2Fcloudflare_worker-gelf_logger.svg)](https://www.npmjs.com/package/@walsys/cloudflare_worker-gelf_logger)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- ✅ **Full GELF 1.1 Specification Compliance** - Complete support for Graylog Extended Log Format
- 🚀 **Non-Blocking Logging** - Fire-and-forget design that never blocks your worker
- 🌐 **Cloudflare Native** - Automatic extraction of Cloudflare-specific context
- 📊 **8 Log Levels** - Emergency, Alert, Critical, Error, Warning, Notice, Info, Debug
- 🔧 **Zero Configuration** - Opinionated defaults that just work
- 📍 **Geo-Location Support** - Automatic latitude/longitude from Cloudflare request
- 🏢 **Colo Tracking** - Know which Cloudflare data center handled the request
- 🎯 **Custom Fields** - Add unlimited custom fields to any log
- 🔄 **Context-Aware** - Child loggers preserve parent context
- 📈 **Built-in Statistics** - Track sent, failed, and skipped logs
- 🛡️ **Graceful Failure** - Logging failures never crash your worker

## Installation

```bash
npm install @walsys/cloudflare_worker-gelf_logger
```

Or with Yarn:

```bash
yarn add @walsys/cloudflare_worker-gelf_logger
```

## Quick Start

```javascript
import { GELFLogger } from '@walsys/cloudflare_worker-gelf_logger';

export default {
  async fetch(request, env, ctx) {
    // Initialize logger with env and request
    const logger = new GELFLogger({ env, request });

    // Log at different levels
    logger.info('User login successful');
    logger.error('Database connection failed');
    logger.debug('Cache miss for key: user-123');

    // Ensure logs are sent before worker terminates
    ctx.waitUntil(logger.flush());

    return new Response('OK');
  }
};
```

## Environment Variables

The logger automatically consumes these Cloudflare Worker environment variables:

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `GELF_LOGGING_URL` | GELF HTTP endpoint URL | Yes | - |
| `WORKER_NAME` | Worker name (used as host identifier) | No | `'cloudflare-worker'` |
| `ENVIRONMENT` | Environment name (e.g., production, staging) | No | Not logged if absent |
| `FUNCTION_NAME` | Function/route name | No | Not logged if absent |

### Setting Environment Variables

In your `wrangler.toml` or `wrangler.jsonc`:

```toml
[vars]
GELF_LOGGING_URL = "https://your-graylog-server.com/gelf"
WORKER_NAME = "api-gateway"
ENVIRONMENT = "production"
FUNCTION_NAME = "user-authentication"
```

## Configuration Options

```javascript
const logger = new GELFLogger({
  // Required: Cloudflare env object
  env: env,

  // Optional: Cloudflare Request object (extracts colo, IP, geo data)
  request: request,

  // Optional: Override GELF endpoint
  endpoint: 'https://custom-graylog.com/gelf',

  // Optional: Override host identifier
  host: 'custom-worker-name',

  // Optional: Facility name
  facility: 'worker',

  // Optional: Global fields added to all logs
  globalFields: {
    app_version: '1.2.3',
    team: 'backend'
  },

  // Optional: Minimum log level (default: INFO)
  minLevel: GELFLogger.LEVELS.DEBUG,

  // Optional: Also log to console (default: true)
  consoleLog: true,

  // Optional: Request timeout in milliseconds (default: 5000)
  timeout: 3000,

  // Optional: Max failed messages to track (default: 50)
  maxFailedMessages: 100
});
```

## Automatic Cloudflare Context

When you pass the `request` object, the logger automatically extracts and includes:

- **`_colo`** - Cloudflare data center code (e.g., "SFO", "LHR")
- **`_client_ip`** - Client's IP address from `cf-connecting-ip` header
- **`_longitude`** - Client's longitude (from `request.cf.longitude`)
- **`_latitude`** - Client's latitude (from `request.cf.latitude`)

These fields are **only included if they exist** - no null values are logged.

## Log Levels

Based on Syslog severity levels:

```javascript
logger.emergency('System is down');        // Level 0 - System unusable
logger.alert('Immediate action required'); // Level 1 - Take action immediately
logger.critical('Critical database error'); // Level 2 - Critical conditions
logger.error('Failed to process payment');  // Level 3 - Error conditions
logger.warning('High memory usage');        // Level 4 - Warning conditions
logger.notice('Config file reloaded');      // Level 5 - Normal but significant
logger.info('User logged in');              // Level 6 - Informational
logger.debug('Cache lookup: user-123');     // Level 7 - Debug messages

// Aliases
logger.warn('Same as warning');             // Alias for warning
logger.log('Same as info');                 // Alias for info
```

## Usage Examples

### Basic Logging

```javascript
logger.info('User authenticated successfully');
logger.error('Payment processing failed', null, {
  user_id: '12345',
  amount: 99.99,
  payment_method: 'stripe'
});
```

### Logging with Full Message

```javascript
logger.warning(
  'High memory usage detected',
  'Memory usage is above 80% threshold. Consider scaling.',
  { memory_percent: 85, threshold: 80 }
);
```

### Exception Logging

```javascript
try {
  await processPayment();
} catch (error) {
  logger.exception(error, {
    user_id: userId,
    context: 'payment-processing'
  });
}
```

### Context-Aware Logging (Child Loggers)

```javascript
// Create a child logger with additional context
const requestLogger = logger.child({
  request_id: crypto.randomUUID(),
  user_id: '12345'
});

// All logs from this child include request_id and user_id
requestLogger.info('Processing user request');
requestLogger.debug('Fetching user data from database');
```

### Custom Fields

```javascript
logger.info('API request completed', null, {
  method: 'POST',
  path: '/api/users',
  status_code: 201,
  duration_ms: 145,
  user_agent: request.headers.get('user-agent')
});
```

### Conditional Logging Based on Level

```javascript
// Only logs at INFO level and below
const logger = new GELFLogger({
  env,
  minLevel: GELFLogger.LEVELS.INFO
});

logger.debug('This will be skipped');  // Skipped
logger.info('This will be logged');     // Logged
```

## API Reference

### Constructor

**`new GELFLogger(config)`**

Creates a new logger instance.

### Logging Methods

- **`emergency(shortMessage, fullMessage?, customFields?)`** - Level 0
- **`alert(shortMessage, fullMessage?, customFields?)`** - Level 1
- **`critical(shortMessage, fullMessage?, customFields?)`** - Level 2
- **`error(shortMessage, fullMessage?, customFields?)`** - Level 3
- **`warning(shortMessage, fullMessage?, customFields?)`** - Level 4
- **`warn(shortMessage, fullMessage?, customFields?)`** - Alias for warning
- **`notice(shortMessage, fullMessage?, customFields?)`** - Level 5
- **`info(shortMessage, fullMessage?, customFields?)`** - Level 6
- **`log(shortMessage, fullMessage?, customFields?)`** - Alias for info
- **`debug(shortMessage, fullMessage?, customFields?)`** - Level 7

### Exception Logging

**`exception(error, customFields?)`**

Logs an error object with automatic stack trace extraction.

### Utility Methods

**`child(contextFields)`**

Creates a child logger with additional context fields.

```javascript
const childLogger = logger.child({ request_id: '12345' });
```

**`async flush()`**

Waits for all pending logs to be sent. Use with `ctx.waitUntil()`.

```javascript
ctx.waitUntil(logger.flush());
```

**`getStats()`**

Returns logging statistics.

```javascript
const stats = logger.getStats();
// { sent: 150, failed: 2, skipped: 10, failedMessagesCount: 2 }
```

**`getFailedMessages(limit?)`**

Returns failed log messages for debugging.

```javascript
const failures = logger.getFailedMessages(5); // Last 5 failures
```

**`getFailureSummary()`**

Returns summary of failure reasons.

```javascript
const summary = logger.getFailureSummary();
// { no_endpoint: 0, http_error: 1, timeout: 1, network_error: 0, other: 0 }
```

**`clearFailedMessages()`**

Clears the failed messages history.

**`resetStats()`**

Resets all statistics and failed messages.

## Best Practices

### 1. Always Use `ctx.waitUntil()`

Ensure logs are sent before your worker terminates:

```javascript
export default {
  async fetch(request, env, ctx) {
    const logger = new GELFLogger({ env, request });

    // Your code here
    logger.info('Processing request');

    // Critical: Ensure logs are sent
    ctx.waitUntil(logger.flush());

    return new Response('OK');
  }
};
```

### 2. Use Child Loggers for Request Context

Create child loggers per request for better tracing:

```javascript
const requestLogger = logger.child({
  request_id: crypto.randomUUID(),
  path: new URL(request.url).pathname
});
```

### 3. Set Appropriate Log Levels for Production

Use INFO or WARNING in production to reduce noise:

```javascript
const logger = new GELFLogger({
  env,
  minLevel: env.ENVIRONMENT === 'production'
    ? GELFLogger.LEVELS.INFO
    : GELFLogger.LEVELS.DEBUG
});
```

### 4. Include Relevant Context in Custom Fields

```javascript
logger.error('Database query failed', null, {
  query: 'SELECT * FROM users',
  table: 'users',
  error_code: 'ER_NO_SUCH_TABLE',
  duration_ms: 150
});
```

### 5. Use Exception Logging for Errors

```javascript
try {
  await riskyOperation();
} catch (error) {
  logger.exception(error, { operation: 'user-update' });
  throw error; // Re-throw if needed
}
```

## Cloudflare-Specific Features

### Automatic Colo Detection

Know which Cloudflare data center handled each request:

```javascript
const logger = new GELFLogger({ env, request });
// Logs automatically include _colo field (e.g., "SFO", "LAX", "LHR")
```

### Geolocation Logging

Track where your users are located:

```javascript
const logger = new GELFLogger({ env, request });
// Logs include _latitude and _longitude from request.cf
```

### Client IP Tracking

Automatically logs the client's real IP:

```javascript
const logger = new GELFLogger({ env, request });
// Logs include _client_ip from cf-connecting-ip header
```

## Performance Considerations

- **Non-Blocking**: Logging never blocks your request handling
- **Fire-and-Forget**: Logs are sent asynchronously
- **Failed Message Tracking**: Limited to 50 messages by default to prevent memory issues
- **Timeout**: Default 5-second timeout prevents hanging requests

## Troubleshooting

### No logs appearing in Graylog?

1. Check that `GELF_LOGGING_URL` is set correctly
2. Verify your Graylog server is accepting GELF HTTP input
3. Check failed messages: `logger.getFailedMessages()`
4. Ensure you're calling `ctx.waitUntil(logger.flush())`

### High failure rate?

```javascript
const stats = logger.getStats();
const summary = logger.getFailureSummary();
console.log('Stats:', stats);
console.log('Failure reasons:', summary);
```

### Logs not appearing for certain levels?

Check your `minLevel` setting. By default, only INFO and above are logged:

```javascript
const logger = new GELFLogger({
  env,
  minLevel: GELFLogger.LEVELS.DEBUG // Include debug logs
});
```

## GELF Message Format

Each log message follows the GELF 1.1 specification:

```json
{
  "version": "1.1",
  "host": "my-worker",
  "short_message": "User login successful",
  "timestamp": 1634567890.123,
  "level": 6,
  "facility": "worker",
  "_environment": "production",
  "_function_name": "auth-handler",
  "_colo": "SFO",
  "_client_ip": "203.0.113.42",
  "_latitude": 37.7749,
  "_longitude": -122.4194,
  "_custom_field": "value"
}
```

## License

MIT © [Your Name]

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Support

- GitHub Issues: [https://github.com/walsys/cloudflare_worker-gelf_logger/issues](https://github.com/walsys/cloudflare_worker-gelf_logger/issues)
- Documentation: [https://github.com/walsys/cloudflare_worker-gelf_logger](https://github.com/walsys/cloudflare_worker-gelf_logger)

---

Made with ❤️ for Cloudflare Workers
