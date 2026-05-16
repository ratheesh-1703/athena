#!/bin/bash

# ATHENA Docker Compose Quick Start Script (Bash)
# Handles validation, build, and initial health checks

set -e

ACTION="${1:-up}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

function check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}✗ Docker not installed or not in PATH${NC}"
        echo -e "${YELLOW}  Download from: https://www.docker.com/products/docker-desktop${NC}"
        exit 1
    fi
    version=$(docker --version)
    echo -e "${GREEN}✓ Docker found: $version${NC}"
}

function check_env() {
    if [ ! -f "$PROJECT_ROOT/backend/.env" ]; then
        echo -e "${RED}✗ Backend .env file not found${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Backend .env file exists${NC}"
}

function run_predeploy_check() {
    echo -e "\n${CYAN}[*] Running predeploy checks...${NC}"
    cd "$PROJECT_ROOT/backend"
    npm run predeploy:check
    echo -e "${GREEN}✓ Predeploy checks passed${NC}"
}

function start_services() {
    echo -e "\n${CYAN}[*] Starting Docker Compose stack...${NC}"
    cd "$PROJECT_ROOT"
    docker compose up -d --build
    echo -e "${GREEN}✓ Services started${NC}"
    echo -e "${YELLOW}  Waiting for MySQL to initialize (30 seconds)...${NC}"
    sleep 30
}

function check_health() {
    echo -e "\n${CYAN}[*] Checking health...${NC}"
    local attempts=0
    local max_attempts=10

    while [ $attempts -lt $max_attempts ]; do
        if response=$(curl -s -f http://localhost:5000/health); then
            status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
            database=$(echo "$response" | grep -o '"database":"[^"]*"' | cut -d'"' -f4)
            echo -e "${GREEN}✓ Backend health: $status${NC}"
            echo -e "${GREEN}✓ Database status: $database${NC}"
            return 0
        fi
        
        attempts=$((attempts + 1))
        if [ $attempts -lt $max_attempts ]; then
            echo -e "${YELLOW}  Attempt $attempts/$max_attempts - waiting...${NC}"
            sleep 5
        fi
    done

    echo -e "${RED}✗ Health check failed after $max_attempts attempts${NC}"
    echo -e "${YELLOW}  Run 'docker compose logs' for details${NC}"
    exit 1
}

function show_logs() {
    cd "$PROJECT_ROOT"
    docker compose logs -f
}

function stop_services() {
    echo -e "\n${CYAN}[*] Stopping services...${NC}"
    cd "$PROJECT_ROOT"
    docker compose down
    echo -e "${GREEN}✓ Services stopped${NC}"
}

function show_status() {
    echo -e "\n${CYAN}[*] Container Status:${NC}"
    cd "$PROJECT_ROOT"
    docker compose ps
}

function run_tests() {
    echo -e "\n${CYAN}[*] Running API tests...${NC}"
    
    echo -e "${YELLOW}  POST /api/auth/register...${NC}"
    if curl -s -X POST http://localhost:5000/api/auth/register \
        -H "Content-Type: application/json" \
        -d '{
            "phone": "+918765432109",
            "password": "TestPass123!",
            "name": "Test User"
        }' > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ User registration successful${NC}"
    else
        echo -e "${RED}  ✗ Test failed${NC}"
    fi
}

# Main execution
echo -e "${CYAN}"
echo "╔═══════════════════════════════════════╗"
echo "║  ATHENA Docker Deployment Helper      ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

check_docker
check_env

case "$ACTION" in
    up)
        run_predeploy_check
        start_services
        check_health
        echo -e "\n${GREEN}✓ ATHENA is ready!${NC}"
        echo -e "${YELLOW}  Backend: http://localhost:5000${NC}"
        echo -e "${YELLOW}  API Docs: See README.md${NC}"
        ;;
    down)
        stop_services
        ;;
    logs)
        show_logs
        ;;
    test)
        run_tests
        ;;
    status)
        show_status
        ;;
    *)
        echo -e "${RED}Unknown action: $ACTION${NC}"
        echo "Usage: $0 {up|down|logs|test|status}"
        exit 1
        ;;
esac

echo ""
