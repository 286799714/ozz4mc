package com.maydaymemory.ozz4mc.mixin;

import com.llamalad7.mixinextras.injector.wrapmethod.WrapMethod;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.sighs.apricityui.init.Element;
import com.sighs.apricityui.render.GeometryQueryScope;
import org.spongepowered.asm.mixin.Mixin;

@Mixin(value = Element.class, remap = false)
abstract class ApricityElementGeometryMixin {
    /**
     * AUI 1.2.8 scopes getBoundingClientRect, but its size getters omit the same
     * layout caches. Reads from timer/rAF callbacks can recursively remeasure
     * the editor's nested flex tree for seconds without those caches.
     */
    @WrapMethod(method = {"getClientWidth", "getClientHeight", "getOffsetWidth", "getOffsetHeight"})
    private double ozz4mc$scopeGeometryRead(Operation<Double> original) {
        Element element = (Element) (Object) this;
        if (element.document == null || !"screens/ozz/editor/index.html".equals(element.document.getPath())) {
            return original.call();
        }
        try (GeometryQueryScope ignored = GeometryQueryScope.open()) {
            return original.call();
        }
    }
}
