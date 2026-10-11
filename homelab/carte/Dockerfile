# Rendu de la carte : synchronisation SFTP (Overworld uniquement) + BlueMap

# 1) BlueMap compilé depuis son code source : la version publiée (5.23) ne gère pas
#    encore Minecraft 26.3, la version en développement oui (couleurs, blocs par défaut…).
#    Quand une version officielle compatible sortira, ce bloc pourra redevenir un simple téléchargement.
FROM eclipse-temurin:25-jdk AS bluemap
ARG BLUEMAP_COMMIT=a61e143fe1e069c536159e0bc79410d5b6da3885
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone https://github.com/BlueMap-Minecraft/BlueMap.git . \
 && git checkout "$BLUEMAP_COMMIT" \
 && git submodule update --init --recursive
RUN ./gradlew --no-daemon :cli:release \
 && cp build/release/bluemap-*-cli.jar /bluemap-cli.jar

# 2) Image finale
FROM eclipse-temurin:25-jre
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates tzdata \
 && pip3 install --no-cache-dir --break-system-packages "paramiko>=3.4" "nbtlib==2.0.4" \
 && rm -rf /var/lib/apt/lists/*
COPY --from=bluemap /bluemap-cli.jar /opt/bluemap-cli.jar
COPY run.py anti-spoil.js /app/

# Utilisateur sans droits particuliers
RUN useradd --uid 1000 --create-home carte || true
USER 1000
WORKDIR /app
ENTRYPOINT ["python3", "-u", "/app/run.py"]
