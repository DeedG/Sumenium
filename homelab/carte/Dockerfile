# Rendu de la carte : synchronisation SFTP (Overworld uniquement) + BlueMap
FROM eclipse-temurin:25-jre

ARG BLUEMAP_VERSION=5.23
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip curl ca-certificates tzdata \
 && pip3 install --no-cache-dir --break-system-packages "paramiko>=3.4" "nbtlib==2.0.4" \
 && curl -fsSL -o /opt/bluemap-cli.jar \
    "https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v${BLUEMAP_VERSION}/bluemap-${BLUEMAP_VERSION}-cli.jar" \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY run.py anti-spoil.js /app/

# Utilisateur sans droits particuliers
RUN useradd --uid 1000 --create-home carte || true
USER 1000
WORKDIR /app
ENTRYPOINT ["python3", "-u", "/app/run.py"]
