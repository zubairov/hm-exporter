# hm-exporter
Prometheus exporter for the state of HomeMatic devices

## Launch with Docker

```bash
docker run -d --restart unless-stopped -p 9140:9140 --name hm-exporter -e "CCU_HOST=192.168.20.3" zubairov/hm-exporter
```
