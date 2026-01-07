docker run -d --name=proget --restart=unless-stopped \
  -v ./proget-packages:/var/proget/packages \
  -v ./proget-database:/var/proget/database  \
  -v ./proget-backups:/var/proget/backups \
  -p 8624:80  \
  proget.inedo.com/productimages/inedo/proget:latest

sleep 10

/opt/microsoft/msedge/msedge http://localhost:8624