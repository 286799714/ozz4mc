package com.maydaymemory.ozz4mc;

import org.slf4j.Logger;

import com.mojang.logging.LogUtils;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.loading.FMLPaths;

@Mod(ozz4mc.MODID)
public class ozz4mc {
    public static final String MODID = "ozz4mc";
    public static final Logger LOGGER = LogUtils.getLogger();

    public ozz4mc(IEventBus modEventBus, ModContainer modContainer) {
        var screensDirectory = FMLPaths.GAMEDIR.get().resolve("apricity/screens");
        ScreenResources.copyTo(modContainer.getModInfo().getOwningFile().getFile().getContents(), screensDirectory);
        LOGGER.info("Copied bundled ozz screens to {}", screensDirectory.resolve("ozz"));
    }
}
