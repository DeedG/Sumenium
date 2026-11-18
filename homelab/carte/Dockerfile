# Rendu de la carte : synchronisation SFTP (Overworld uniquement) + BlueMap + joueurs en direct
FROM eclipse-temurin:25-jre

# BlueMap officiel (la 5.29 gère Minecraft 26.3) ; empreinte vérifiée au téléchargement.
# Pour changer de version : BLUEMAP_VERSION et BLUEMAP_SHA256 (sha256sum du bluemap-X-cli.jar de la page des versions).
ARG BLUEMAP_VERSION=5.29
ARG BLUEMAP_SHA256=e830767fa6364b52b9310fb598508ebde7eec5ebe8360a989e240d991af89a3a

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates tzdata curl \
 && pip3 install --no-cache-dir --break-system-packages "paramiko>=3.4" "nbtlib==2.0.4" "pillow>=10" \
 && curl -fsSL -o /opt/bluemap-cli.jar \
      "https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v${BLUEMAP_VERSION}/bluemap-${BLUEMAP_VERSION}-cli.jar" \
 && echo "${BLUEMAP_SHA256}  /opt/bluemap-cli.jar" | sha256sum -c - \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
COPY run.py anti-spoil.js /app/

# Utilisateur sans droits particuliers
RUN useradd --uid 1000 --create-home carte || true
USER 1000
WORKDIR /app
ENTRYPOINT ["python3", "-u", "/app/run.py"]
