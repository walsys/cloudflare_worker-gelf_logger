import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GELFLogger } from '../src/gelf-logger.js';

describe('GELFLogger Context (AsyncLocalStorage)', () => {
	let mockEnv;

	beforeEach(() => {
		mockEnv = {
			GELF_LOGGING_URL: 'http://test-graylog.com/gelf',
			WORKER_NAME: 'test-worker',
		};
	});

	it('should return null when no logger is in context', () => {
		expect(GELFLogger.current).toBeNull();
	});

	it('should provide access to logger within run context', () => {
		const logger = new GELFLogger({ env: mockEnv });
		
		logger.run(() => {
			const current = GELFLogger.current;
			expect(current).toBe(logger);
			expect(current.host).toBe('test-worker');
		});
	});

	it('should handle nested contexts correctly', () => {
		const logger1 = new GELFLogger({ env: mockEnv, host: 'logger-1' });
		const logger2 = new GELFLogger({ env: mockEnv, host: 'logger-2' });

		logger1.run(() => {
			expect(GELFLogger.current.host).toBe('logger-1');

			logger2.run(() => {
				expect(GELFLogger.current.host).toBe('logger-2');
			});

			expect(GELFLogger.current.host).toBe('logger-1');
		});
	});

	it('should isolate contexts in async operations', async () => {
		const logger1 = new GELFLogger({ env: mockEnv, host: 'logger-1' });
		const logger2 = new GELFLogger({ env: mockEnv, host: 'logger-2' });

		const p1 = logger1.run(async () => {
			await new Promise(resolve => setTimeout(resolve, 10));
			expect(GELFLogger.current.host).toBe('logger-1');
			return 'done1';
		});

		const p2 = logger2.run(async () => {
			await new Promise(resolve => setTimeout(resolve, 5));
			expect(GELFLogger.current.host).toBe('logger-2');
			return 'done2';
		});

		await Promise.all([p1, p2]);
	});
});
