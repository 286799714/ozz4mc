package com.maydaymemory.ozz4mc;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import net.neoforged.fml.jarcontents.JarContents;

final class ScreenResources {
    private ScreenResources() {
    }

    static void copyTo(JarContents resources, Path screensDirectory) {
        if (!resources.containsFile("ozz/editor/index.html")) {
            throw new IllegalStateException("Missing bundled ozz editor resources");
        }

        // JarContents supports both development resource folders and packaged mod jars.
        resources.visitContent("ozz", (relativePath, resource) -> {
            var target = screensDirectory.resolve(relativePath);
            try (var input = resource.open()) {
                Files.createDirectories(target.getParent());
                Files.copy(input, target, StandardCopyOption.REPLACE_EXISTING);
                if (relativePath.equals("ozz/editor/index.html") && Boolean.getBoolean("ozz4mc.profile")) {
                    Files.writeString(target, Files.readString(target)
                            .replace("data-oz-profile=\"false\"", "data-oz-profile=\"true\""));
                }
            } catch (IOException e) {
                throw new UncheckedIOException("Failed to copy bundled screen to " + target, e);
            }
        });
    }
}
