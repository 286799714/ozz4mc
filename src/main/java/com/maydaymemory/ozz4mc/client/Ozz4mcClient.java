package com.maydaymemory.ozz4mc.client;

import com.maydaymemory.ozz4mc.ozz4mc;
import com.mojang.blaze3d.platform.InputConstants;
import com.sighs.apricityui.ApricityUI;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.Identifier;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.client.settings.KeyConflictContext;
import net.neoforged.neoforge.common.NeoForge;
import org.lwjgl.glfw.GLFW;

@Mod(value = ozz4mc.MODID, dist = Dist.CLIENT)
public final class Ozz4mcClient {
    private static final KeyMapping.Category CATEGORY = new KeyMapping.Category(
            Identifier.fromNamespaceAndPath(ozz4mc.MODID, "editor"));
    private static final KeyMapping OPEN_EDITOR = new KeyMapping(
            "key.ozz4mc.open_editor", KeyConflictContext.IN_GAME,
            InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_F8, CATEGORY);

    public Ozz4mcClient(IEventBus modEventBus) {
        modEventBus.addListener(Ozz4mcClient::registerKeyMappings);
        NeoForge.EVENT_BUS.addListener(Ozz4mcClient::onClientTick);
        if (Boolean.getBoolean("ozz4mc.profile")) {
            ClientPerformanceDiagnostics.start();
        }
    }

    private static void registerKeyMappings(RegisterKeyMappingsEvent event) {
        event.registerCategory(CATEGORY);
        event.register(OPEN_EDITOR);
    }

    private static void onClientTick(ClientTickEvent.Post event) {
        while (OPEN_EDITOR.consumeClick()) {
            if (Minecraft.getInstance().screen == null) {
                ApricityUI.screen("screens/ozz/editor/index.html");
            }
        }
    }
}
