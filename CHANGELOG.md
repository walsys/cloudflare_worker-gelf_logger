# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-14

### Added

#### Core Features
- **GELF Logger Class**: Complete GELF 1.1 specification compliance
- **Non-blocking Logging**: Fire-and-forget design using fetch promises
- **8 Log Levels**: Emergency, Alert, Critical, Error, Warning, Notice, Info, Debug
- **Exception Logging**: Automatic stack trace extraction from Error objects
- **Child Loggers**: Context-aware logging with inherited fields

#### Cloudflare Integration
- **Automatic Environment Variables**: Extracts from `env` object:
  - `GELF_LOGGING_URL` - GELF endpoint (required)
  - `WORKER_NAME` - Host identifier
  - `ENVIRONMENT` - Environment name (only logged if present)
  - `FUNCTION_NAME` - Function name (only logged if present)

- **Automatic Request Context**: Extracts from `request` object:
  - `_colo` - Cloudflare data center code
  - `_client_ip` - Client IP from cf-connecting-ip header
  - `_longitude` - Client longitude from request.cf
  - `_latitude` - Client latitude from request.cf

#### Configuration Options
- `env` - Cloudflare Worker env object
- `request` - Cloudflare Request object for context extraction
- `endpoint` - Override GELF endpoint URL
- `host` - Override host identifier
- `facility` - Override facility name
- `globalFields` - Global custom fields for all logs
- `minLevel` - Minimum log level (default: INFO)
- `consoleLog` - Enable console logging (default: true)
- `timeout` - Request timeout in ms (default: 5000)
- `maxFailedMessages` - Max failed messages to track (default: 50)

#### Utility Methods
- `flush()` - Wait for all pending logs to complete
- `getStats()` - Get logging statistics
- `getFailedMessages(limit)` - Get failed log messages
- `getFailureSummary()` - Get summary of failure reasons
- `clearFailedMessages()` - Clear failed messages history
- `resetStats()` - Reset statistics

#### Documentation
- Comprehensive README.md with usage examples
- NPM publishing guide (PUBLISHING.md)
- MIT License
- Package.json configured for NPM

### Technical Details

- **Non-opinionated**: Environment and function name only logged if present
- **Graceful Failure**: Logging errors never crash the worker
- **Memory Safe**: Failed message tracking limited to prevent memory issues
- **Timeout Protection**: 5-second default timeout prevents hanging requests
- **Promise Cleanup**: Automatic cleanup of resolved promises

### Files Structure

```
src/
  gelf-logger.js       # Main logger class
  index.js             # Example usage
README.md              # Documentation
PUBLISHING.md          # NPM publishing guide
CHANGELOG.md           # This file
LICENSE                # MIT License
package.json           # NPM package configuration
.npmignore             # NPM publish exclusions
```

### Breaking Changes

None - this is the initial release.

### Migration Guide

This is the first version. For usage instructions, see README.md.

### Contributors

- [Your Name] - Initial implementation

---

## Release Notes Template (for future releases)

### [Version] - YYYY-MM-DD

#### Added
- New features

#### Changed
- Changes to existing functionality

#### Deprecated
- Features that will be removed in future versions

#### Removed
- Removed features

#### Fixed
- Bug fixes

#### Security
- Security fixes
