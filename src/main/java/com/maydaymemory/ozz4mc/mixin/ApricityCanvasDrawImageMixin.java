package com.maydaymemory.ozz4mc.mixin;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.sighs.apricityui.canvas.CanvasRenderingContext2D;
import com.sighs.apricityui.element.Canvas;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

import java.awt.image.BufferedImage;

@Mixin(value = CanvasRenderingContext2D.class, remap = false)
abstract class ApricityCanvasDrawImageMixin {
    /**
     * AUI 1.2.8 snapshots the entire source Canvas even for tiny source rectangles.
     * Its drawImage/renderOperation pipeline consumes the pixels synchronously,
     * so distinct canvases in this editor can share the source during that call.
     * Keep snapshots for self-draws, and leave createPattern's snapshot untouched.
     */
    @WrapOperation(
            method = {
                    "drawImage(Ljava/lang/Object;DD)V",
                    "drawImage(Ljava/lang/Object;DDDD)V",
                    "drawImage(Ljava/lang/Object;DDDDDDDD)V"
            },
            at = @At(value = "INVOKE", target = "Lcom/sighs/apricityui/canvas/CanvasRenderingContext2D;resolveImageSource(Ljava/lang/Object;)Ljava/awt/image/BufferedImage;"),
            require = 3)
    private BufferedImage ozz4mc$resolveDrawImageSource(CanvasRenderingContext2D context, Object image,
                                                       Operation<BufferedImage> original) {
        Canvas target = context.getCanvas();
        if (image instanceof Canvas source && source != target
                && target.document != null && source.document == target.document
                && "screens/ozz/editor/index.html".equals(target.document.getPath())) {
            return source.getSurface();
        }
        return original.call(context, image);
    }
}
