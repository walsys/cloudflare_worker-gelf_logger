# GELF Logger Implementation & Refactoring Guide

This guide details how to implement `@walsys/cloudflare_worker-gelf_logger` in your Cloudflare Workers, specifically focusing on the context-aware features that allow you to access the logger anywhere in your application without prop-drilling.

## 1. Core Concepts

The library uses `AsyncLocalStorage` to maintain a "global" logger instance for the duration of a single request. This means you only need to:
1.  **Instantiate** the logger once at the entry point (Main Thread).
2.  **Wrap** your execution logic in `logger.run()`.
3.  **Access** the logger anywhere else using `GELFLogger.current`.

## 2. Main Thread Implementation (Entry Point)

In your main worker file (usually `worker.js` or `index.js`), you initialize the logger and establish the context.

```javascript
// src/worker.js
import { GELFLogger } from '@walsys/cloudflare_worker-gelf_logger';
import { handleRequest } from './router';

export default {
  async fetch(request, env, ctx) {
    // 1. Initialize Logger
    // We pass 'request' to automatically extract IP, Colo, User-Agent, etc.
    const logger = new GELFLogger({ 
      env, 
      request,
      // Optional: Explicit session ID (otherwise generated automatically)
      // log_session_id: request.headers.get('x-correlation-id') 
    });

    // 2. Run within Context
    // Everything inside this callback has access to 'logger' via GELFLogger.current
    return logger.run(async () => {
      try {
        logger.info('Incoming request started');
        
        // Execute your main application logic
        const response = await handleRequest(request);
        
        logger.info('Request completed successfully', null, { 
          status: response.status 
        });
        
        return response;
      } catch (error) {
        logger.exception(error);
        return new Response('Internal Server Error', { status: 500 });
      } finally {
        // 3. Flush logs (Critical for Workers)
        // Ensure logs are sent before the worker runtime kills the process
        ctx.waitUntil(logger.flush());
      }
    });
  }
};
```

## 3. Downstream Implementation (Services/Utils)

In your services, repositories, or utility functions, you no longer need to accept `env` or `logger` as arguments.

```javascript
// src/services/userService.js
import { GELFLogger } from '@walsys/cloudflare_worker-gelf_logger';

export async function getUser(userId) {
  // 1. Get the current logger instance
  const logger = GELFLogger.current;

  // It's good practice to check if logger exists (e.g. for unit tests)
  logger?.debug('Fetching user from database', null, { userId });

  try {
    const user = await db.users.get(userId);
    
    if (!user) {
      logger?.warn('User not found', null, { userId });
      return null;
    }

    return user;
  } catch (err) {
    // Context is preserved! This log will have the same request_id, ip, etc.
    logger?.error('Database error in getUser', err.message);
    throw err;
  }
}
```

## 4. Refactoring Guide

If you are refactoring an existing application, look for these patterns to clean up.

### ❌ Before (Prop-Drilling)

You likely had to pass `env` or `logger` deep into your dependency tree.

```javascript
// worker.js
export default {
  async fetch(req, env, ctx) {
    const logger = new GELFLogger({ env });
    // Passing logger down...
    return await handleRequest(req, env, logger); 
  }
}

// router.js
export async function handleRequest(req, env, logger) {
  // Passing logger down again...
  return await userService.getUser(req.params.id, logger); 
}

// userService.js
export async function getUser(id, logger) {
  logger.info('Getting user'); // Usage
}
```

### ✅ After (Context-Aware)

Remove the logger/env arguments from your function signatures.

```javascript
// worker.js
export default {
  async fetch(req, env, ctx) {
    const logger = new GELFLogger({ env });
    // Wrap in run()
    return logger.run(() => handleRequest(req)); 
  }
}

// router.js
// Signature is cleaner
export async function handleRequest(req) {
  return await userService.getUser(req.params.id); 
}

// userService.js
import { GELFLogger } from '@walsys/cloudflare_worker-gelf_logger';

// Signature is cleaner
export async function getUser(id) {
  // Grab logger from context
  GELFLogger.current?.info('Getting user'); 
}
```

## 5. Advanced Usage: Child Loggers

If you need to add specific context to a specific flow (e.g., a specific transaction), you can still use child loggers, but you might want to run them in a *nested* context if you want that child to be the "current" logger for downstream functions.

```javascript
async function processOrder(orderId) {
  const parentLogger = GELFLogger.current;
  
  // Create a child logger with order context
  const orderLogger = parentLogger.child({ order_id: orderId });

  // Run downstream code using this specific child logger as "current"
  return orderLogger.run(async () => {
    // Inside here, GELFLogger.current is the 'orderLogger'
    await validateOrder(); 
    await chargeCard();
  });
}
```

## 6. Testing Considerations

When testing functions that use `GELFLogger.current`, you need to wrap your test execution in a logger context, or mock the static getter.

**Option A: Wrap in Test (Recommended)**

```javascript
import { GELFLogger } from '@walsys/cloudflare_worker-gelf_logger';
import { getUser } from './userService';

test('getUser logs access', async () => {
  const logger = new GELFLogger({ env: mockEnv });
  
  await logger.run(async () => {
    await getUser('123');
    // Assertions...
  });
});
```

**Option B: Mocking (Vitest Example)**

```javascript
import { GELFLogger } from '@walsys/cloudflare_worker-gelf_logger';

vi.spyOn(GELFLogger, 'current', 'get').mockReturnValue(mockLoggerInstance);
```
