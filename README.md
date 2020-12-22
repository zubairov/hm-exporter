# hm-exporter
Prometheus exporter for the state of HomeMatic devices

## Launch with Docker

```bash
docker run -d --restart unless-stopped -p 9140:9140 --name hm-exporter zubairov/hm-exporter
```