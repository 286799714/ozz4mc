package com.maydaymemory.ozz4mc.client;

import com.maydaymemory.ozz4mc.ozz4mc;
import jdk.jfr.Category;
import jdk.jfr.Event;
import jdk.jfr.Label;
import jdk.jfr.Name;
import jdk.jfr.StackTrace;
import net.minecraft.client.Minecraft;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RenderFrameEvent;
import net.neoforged.neoforge.common.NeoForge;

/** Opt-in diagnostics for stalls, including stalls that prevent the next frame from finishing. */
final class ClientPerformanceDiagnostics {
    private static volatile Thread clientThread;
    private static volatile long lastProgress;
    private static volatile String phase = "waiting for client";
    private static long frameStart;
    private static long previousFrameStart;
    private static FrameTiming frameTiming;

    @Name("ozz4mc.FrameTiming")
    @Label("Editor client frame")
    @Category("ozz4mc")
    @StackTrace(false)
    static final class FrameTiming extends Event {
        @Label("Frame interval (ms)")
        public double intervalMillis;
        @Label("Screen class")
        public String screen;
    }

    private ClientPerformanceDiagnostics() {
    }

    static void start() {
        NeoForge.EVENT_BUS.addListener(ClientPerformanceDiagnostics::beforeTick);
        NeoForge.EVENT_BUS.addListener(ClientPerformanceDiagnostics::afterTick);
        NeoForge.EVENT_BUS.addListener(ClientPerformanceDiagnostics::beforeFrame);
        NeoForge.EVENT_BUS.addListener(ClientPerformanceDiagnostics::afterFrame);
        Thread.ofPlatform().daemon().name("ozz4mc-stall-watchdog").start(ClientPerformanceDiagnostics::watch);
        ozz4mc.LOGGER.info("[OZZ PERF] Diagnostics enabled; JFR recording is saved to ozz-profile.jfr on normal exit");
    }

    private static void progress(String nextPhase) {
        clientThread = Thread.currentThread();
        phase = nextPhase;
        lastProgress = System.nanoTime();
    }

    private static void beforeTick(ClientTickEvent.Pre event) {
        progress("client tick");
    }

    private static void afterTick(ClientTickEvent.Post event) {
        progress("after client tick");
    }

    private static void beforeFrame(RenderFrameEvent.Pre event) {
        progress("render frame");
        frameStart = System.nanoTime();
        frameTiming = new FrameTiming();
        frameTiming.intervalMillis = previousFrameStart == 0 ? 0 : (frameStart - previousFrameStart) / 1_000_000.0;
        previousFrameStart = frameStart;
        var screen = Minecraft.getInstance().screen;
        frameTiming.screen = screen == null ? "game" : screen.getClass().getSimpleName();
        frameTiming.begin();
    }

    private static void afterFrame(RenderFrameEvent.Post event) {
        if (frameTiming != null) {
            frameTiming.end();
            frameTiming.commit();
            frameTiming = null;
        }
        long elapsedMs = (System.nanoTime() - frameStart) / 1_000_000;
        progress("after render frame");
        if (elapsedMs >= 250) {
            ozz4mc.LOGGER.warn("[OZZ PERF] Slow render frame: {} ms", elapsedMs);
        }
    }

    private static void watch() {
        long lastReport = 0;
        while (!Thread.currentThread().isInterrupted()) {
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            Thread target = clientThread;
            long observedProgress = lastProgress;
            long now = System.nanoTime();
            if (target == null || !target.isAlive() || observedProgress == 0
                    || now - observedProgress < 750_000_000L || now - lastReport < 2_000_000_000L) {
                continue;
            }
            String observedPhase = phase;
            StackTraceElement[] trace = target.getStackTrace();
            if (lastProgress != observedProgress) continue;
            lastReport = now;
            StringBuilder stack = new StringBuilder();
            for (int i = 0; i < Math.min(trace.length, 48); i++) {
                stack.append("\n    at ").append(trace[i]);
            }
            ozz4mc.LOGGER.warn("[OZZ PERF] No client progress for {} ms; phase={}; state={}{}",
                    (now - observedProgress) / 1_000_000, observedPhase, target.getState(), stack);
        }
    }
}
