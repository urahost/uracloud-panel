# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dokploy is a self-hostable Platform as a Service (PaaS) that simplifies deployment and management of applications and databases. It's built as a monorepo using pnpm workspaces with Next.js frontend and tRPC API architecture.

## Development Commands

### Main Development
- `pnpm dokploy:dev` - Start development server
- `pnpm dokploy:dev:turbopack` - Start development with Turbopack (faster)
- `pnpm dokploy:build` - Build the main application
- `pnpm dokploy:start` - Start production server
- `pnpm dokploy:setup` - Initial setup and database migration

### Database Operations
- `pnpm --filter=dokploy run migration:generate` - Generate new database migration
- `pnpm --filter=dokploy run migration:run` - Run pending migrations
- `pnpm --filter=dokploy run studio` - Open Drizzle Studio for database management
- `pnpm --filter=dokploy run db:seed` - Seed database with initial data
- `pnpm --filter=dokploy run db:clean` - Clean/reset database

### Code Quality
- `pnpm check` - Format and lint code using Biome
- `pnpm typecheck` - Type check all packages
- `pnpm test` - Run tests using Vitest

### Individual Apps
- `pnpm server:dev` - Start server package in development
- `pnpm --filter=monitoring run dev` - Start monitoring app
- `pnpm --filter=schedules run dev` - Start schedules app

## Architecture

### Monorepo Structure
- `apps/dokploy/` - Main Next.js application with dashboard UI
- `apps/api/` - Standalone API service
- `apps/monitoring/` - Go-based monitoring service
- `apps/schedules/` - Background job scheduling service
- `packages/server/` - Shared server utilities and types

### Core Technologies
- **Frontend**: Next.js 15 with React 18, TypeScript, Tailwind CSS
- **Backend**: tRPC for type-safe APIs, Drizzle ORM with PostgreSQL
- **Queue System**: BullMQ with Redis for background jobs
- **Container Management**: Dockerode for Docker API interactions
- **Authentication**: Better-auth with 2FA support
- **UI Components**: Radix UI primitives with custom styling

### Key Components

#### API Structure (apps/dokploy/server/api/)
The tRPC API is organized into feature-based routers:
- `routers/application.ts` - Application deployment and management
- `routers/docker.ts` - Docker container operations
- `routers/database/` - Database management (MySQL, PostgreSQL, Redis, MongoDB, MariaDB)
- `routers/compose.ts` - Docker Compose operations
- `routers/deployment.ts` - Deployment pipeline management
- `routers/domain.ts` - Domain and SSL certificate management
- `routers/git-provider.ts` - Git integration (GitHub, GitLab, Gitea, Bitbucket)

#### Database Schema (apps/dokploy/server/db/schema/)
Uses Drizzle ORM with PostgreSQL. All schema definitions are in the schema directory.

#### Queue System (apps/dokploy/server/queues/)
Background job processing using BullMQ for deployments and scheduled tasks.

#### WebSocket Handlers (apps/dokploy/server/wss/)
Real-time communication for:
- Container logs streaming
- Terminal access
- Deployment status updates
- Docker statistics monitoring

### Key Features Implementation
- **Multi-server management**: Remote Docker API connections via SSH tunneling
- **Git integration**: Webhook handling for automatic deployments
- **Template system**: Pre-configured application templates in `templates/`
- **Backup system**: Automated database and volume backups
- **Monitoring**: Real-time resource usage tracking
- **Traefik integration**: Automatic reverse proxy configuration

## Development Guidelines

### Code Organization
- Components are organized by feature in `components/dashboard/`
- Shared UI components are in `components/ui/`
- Server-side logic is modular with clear separation of concerns
- Database operations use Drizzle ORM with type-safe queries

### Testing
- Tests are located in `__test__/` directory
- Uses Vitest for unit testing
- Test configuration in `__test__/vitest.config.ts`

### Internationalization
- Uses next-i18next for i18n support
- Translation files in `public/locales/`
- Supports 20+ languages

### Environment Setup
- Requires Node.js ^20.16.0 and pnpm >=9.5.0
- Uses dotenv for environment configuration
- Database setup requires PostgreSQL and Redis

## Docker Integration

The application heavily integrates with Docker:
- Direct Docker API usage through dockerode
- Support for Docker Compose deployments
- Container log streaming and terminal access
- Docker Swarm multi-node support
- Image building and registry management