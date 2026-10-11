package de.bluecolored.bluemap.core.world.mca.data;

import de.bluecolored.bluemap.core.util.Key;
import de.bluecolored.bluemap.core.world.BlockState;
import de.bluecolored.bluenbt.NBTReader;
import de.bluecolored.bluenbt.TagType;
import de.bluecolored.bluenbt.TypeDeserializer;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Patch Suménium : accepte aussi le format de palette de Minecraft 26.3, où un bloc sans
 * propriétés est écrit comme une simple chaîne ("minecraft:stone") — enveloppée dans un compound
 * à clé vide ({"": "minecraft:stone"}) dans une liste mélangée — et un bloc avec propriétés comme
 * {id: "...", properties: {...}} au lieu de {Name: "...", Properties: {...}}.
 */
public class BlockStateDeserializer implements TypeDeserializer<BlockState> {

    @Override
    public BlockState read(NBTReader reader) throws IOException {
        if (reader.peek() == TagType.STRING) {
            return new BlockState(Key.parse(reader.nextString()));
        }

        reader.beginCompound();

        String id = null;
        Map<String, String> properties = null;

        while (reader.hasNext()) {
            switch (reader.name()) {
                case "Name", "id", "" -> {
                    if (reader.peek() == TagType.STRING) id = reader.nextString();
                    else reader.skip();
                }
                case "Properties", "properties" -> {
                    properties = new LinkedHashMap<>();
                    reader.beginCompound();
                    while (reader.hasNext())
                        properties.put(reader.name(), reader.nextString());
                    reader.endCompound();
                }
                default -> reader.skip();
            }
        }

        reader.endCompound();

        if (id == null) throw new IOException("Invalid BlockState, Name is missing!");

        Key key = Key.parse(id);
        return properties == null ? new BlockState(key) : new BlockState(key, properties);
    }

}
