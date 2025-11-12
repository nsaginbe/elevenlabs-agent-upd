#!/bin/bash
# HTTPS Setup Script for moonaisales.app
# Run this script on the server after SSH connection

set -e

DOMAIN="moonaisales.app"
EMAIL="admin@${DOMAIN}"  # Change this to your email

echo "=== Setting up HTTPS for ${DOMAIN} ==="

# Update system packages
echo "Updating system packages..."
apt-get update -y

# Install certbot
echo "Installing Certbot..."
apt-get install -y certbot

# Create webroot directory for certbot
echo "Creating webroot directory..."
mkdir -p /var/www/certbot

# Check if domain is pointing to this server
echo "Checking if domain ${DOMAIN} points to this server..."
SERVER_IP=$(curl -s ifconfig.me || curl -s ipinfo.io/ip)
echo "Server IP: ${SERVER_IP}"
echo "Make sure ${DOMAIN} and www.${DOMAIN} DNS A records point to ${SERVER_IP}"
read -p "Press Enter to continue after verifying DNS..."

# Method 1: Try webroot mode first (doesn't require stopping containers)
echo "Attempting to obtain certificate using webroot mode..."
if certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  --non-interactive \
  --agree-tos \
  --email "${EMAIL}" \
  -d "${DOMAIN}" \
  -d "www.${DOMAIN}"; then
  echo "Certificate obtained using webroot mode!"
else
  echo "Webroot mode failed. Trying standalone mode (will temporarily stop nginx)..."
  # Stop nginx container temporarily for certificate generation
  docker stop moonai-frontend 2>/dev/null || echo "Container not running"
  
  # Obtain SSL certificate using standalone mode
  certbot certonly --standalone \
    --non-interactive \
    --agree-tos \
    --email "${EMAIL}" \
    -d "${DOMAIN}" \
    -d "www.${DOMAIN}" \
    || { echo "Certificate generation failed!"; exit 1; }
  
  # Restart nginx container
  docker start moonai-frontend 2>/dev/null || echo "Container will start with docker-compose"
fi

# Create directories for certificates if they don't exist
echo "Creating certificate directories..."
mkdir -p /etc/ssl/certs
mkdir -p /etc/ssl/private

# Copy certificates to locations expected by nginx
echo "Copying certificates..."
cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem /etc/ssl/certs/nginx-ssl.crt
cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem /etc/ssl/private/nginx-ssl.key

# Set proper permissions
chmod 644 /etc/ssl/certs/nginx-ssl.crt
chmod 600 /etc/ssl/private/nginx-ssl.key

# Create renewal hook script
echo "Creating renewal hook script..."
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh << 'EOF'
#!/bin/bash
# Copy renewed certificates
cp /etc/letsencrypt/live/moonaisales.app/fullchain.pem /etc/ssl/certs/nginx-ssl.crt
cp /etc/letsencrypt/live/moonaisales.app/privkey.pem /etc/ssl/private/nginx-ssl.key
chmod 644 /etc/ssl/certs/nginx-ssl.crt
chmod 600 /etc/ssl/private/nginx-ssl.key
# Reload nginx in Docker
docker exec moonai-frontend nginx -s reload || docker restart moonai-frontend
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# Set up automatic renewal
echo "Setting up automatic certificate renewal..."
(crontab -l 2>/dev/null | grep -v "certbot renew" || true; echo "0 3 * * * certbot renew --quiet") | crontab -

echo ""
echo "=== HTTPS setup complete! ==="
echo "Certificates are located at:"
echo "  Certificate: /etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
echo "  Private Key: /etc/letsencrypt/live/${DOMAIN}/privkey.pem"
echo ""
echo "Next steps:"
echo "1. Make sure docker-compose.yml is updated with new certificate paths"
echo "2. Make sure nginx.conf is updated to use Let's Encrypt certificates"
echo "3. Restart the frontend container: docker-compose restart frontend"
echo "4. Test HTTPS: curl -I https://${DOMAIN}"

