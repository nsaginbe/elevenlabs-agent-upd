# Docker Production Setup

This project includes a minimal Docker Compose setup for production deployment.

## Services

- **Backend**: FastAPI application (Python 3.11)
- **Frontend**: React + Vite application served with Nginx

## Prerequisites

- Docker and Docker Compose installed
- Environment variables configured (see below)

## Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# Backend Configuration
BACKEND_PORT=8000
DATABASE_URL=sqlite:///./sales_training.db

# Frontend Configuration
FRONTEND_PORT=80

# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id_here
ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id_here

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini

# CORS Configuration (optional)
CORS_ORIGINS=http://localhost:80,http://localhost:5173
```

## Usage

### Build and start all services

```bash
docker-compose up -d --build
```

### View logs

```bash
docker-compose logs -f
```

### Stop services

```bash
docker-compose down
```

### Stop and remove volumes

```bash
docker-compose down -v
```

## Access

- **Frontend**: http://localhost:80 (or port specified in `FRONTEND_PORT`)
- **Backend API**: http://localhost:8000 (or port specified in `BACKEND_PORT`)
- **Backend Health**: http://localhost:8000/health

## Architecture

- Frontend is built as a static React app and served via Nginx
- Nginx proxies `/api/*` requests to the backend service
- Both services communicate via Docker network (`moonai-network`)
- Database (SQLite) is persisted via volume mount
- Health checks ensure services are running correctly

## Production Considerations

1. **Database**: Consider using PostgreSQL or MySQL instead of SQLite for production
2. **SSL/TLS**: Add a reverse proxy (e.g., Traefik, Nginx) with SSL certificates
3. **Environment Variables**: Use Docker secrets or a secrets management service
4. **Monitoring**: Add logging and monitoring solutions
5. **Scaling**: Backend can be scaled horizontally if using a shared database

