# Rendu de la carte : synchronisation SFTP (Overworld uniquement) + BlueMap

# 1) BlueMap, corrigé pour lire le format de chunks de Minecraft 26.3
FROM eclipse-temurin:25-jdk AS bluemap
ARG BLUEMAP_VERSION=5.23
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o bluemap-cli.jar \
    "https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v${BLUEMAP_VERSION}/bluemap-${BLUEMAP_VERSION}-cli.jar"
COPY patches/ src/
RUN mkdir out \
 && javac -nowarn -cp bluemap-cli.jar -d out $(find src -name "*.java") \
 && cd out && jar uf ../bluemap-cli.jar $(find . -name "*.class")

# 2) Image finale
FROM eclipse-temurin:25-jre
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates tzdata \
 && pip3 install --no-cache-dir --break-system-packages "paramiko>=3.4" "nbtlib==2.0.4" \
 && rm -rf /var/lib/apt/lists/*
COPY --from=bluemap /build/bluemap-cli.jar /opt/bluemap-cli.jar
COPY run.py anti-spoil.js /app/

# Utilisateur sans droits particuliers
RUN useradd --uid 1000 --create-home carte || true
USER 1000
WORKDIR /app
ENTRYPOINT ["python3", "-u", "/app/run.py"]
