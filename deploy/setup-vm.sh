#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 VM (Oracle Cloud Always Free: Ampere A1 or E2.1.Micro).
# Adds swap on small VMs, installs Docker + Compose and opens ports 80/443 in the VM's own firewall.
#
# Run ON THE VM:   bash setup-vm.sh
# (deploy.sh copies this file to the VM and runs it for you on the first deploy.)
set -euo pipefail

APP_DIR=/opt/live-translate

# Small VMs (e.g. the Always Free VM.Standard.E2.1.Micro with 1 GB RAM) need swap,
# otherwise `npm ci` / `tsc` during the Docker build can run out of memory.
TOTAL_MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$TOTAL_MEM_MB" -lt 4000 ] && ! swapon --show | grep -q /swapfile; then
  echo "==> Adding 2 GB swap (VM has ${TOTAL_MEM_MB} MB RAM)"
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  # Only use swap under real memory pressure.
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf >/dev/null
  sudo sysctl -q -p /etc/sysctl.d/99-swappiness.conf
fi

echo "==> Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
fi
sudo usermod -aG docker "$USER"

echo "==> Opening ports 80 and 443 in the VM firewall"
# Oracle's Ubuntu images ship iptables rules that reject everything except SSH.
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save
else
  sudo apt-get install -y iptables-persistent
  sudo netfilter-persistent save
fi

echo "==> Creating $APP_DIR"
sudo mkdir -p "$APP_DIR"
sudo chown "$USER":"$USER" "$APP_DIR"

echo "==> VM ready."
