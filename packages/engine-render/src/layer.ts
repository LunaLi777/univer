/**
 * Copyright 2023-present DreamNum Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Nullable } from '@univerjs/core';
import { Disposable, requestImmediateMacroTask, sortRules, toDisposable } from '@univerjs/core';

import { BaseObject } from './base-object';
import { RENDER_CLASS_TYPE } from './basics/const';
import { Canvas } from './canvas';
import type { UniverRenderingContext } from './context';
import type { Scene } from './scene';
import type { SceneViewer } from './scene-viewer';

export class Layer extends Disposable {
    private _objects: BaseObject[] = [];

    private _cacheCanvas: Nullable<Canvas>;

    protected _dirty: boolean = true;

    private _debounceDirtyFunc: Nullable<() => void>;

    constructor(
        private _scene: Scene,
        objects: BaseObject[] = [],
        private _zIndex: number = 1,
        private _allowCache: boolean = false
    ) {
        super();

        this.addObjects(objects);

        if (this._allowCache) {
            this._initialCacheCanvas();
        }
    }

    get scene() {
        return this._scene;
    }

    get zIndex() {
        return this._zIndex;
    }

    enableCache() {
        this._allowCache = true;
        this._initialCacheCanvas();
    }

    disableCache() {
        this._allowCache = false;
        this._cacheCanvas?.dispose();
        this._cacheCanvas = null;
    }

    isAllowCache() {
        return this._allowCache;
    }

    getObjectsByOrder() {
        const objects: BaseObject[] = [];
        this._objects.sort(sortRules);
        for (const o of this._objects) {
            if (!o.isInGroup && o.visible) {
                objects.push(o);
            }
        }
        return objects;
    }

    getObjectsByOrderForPick() {
        const objects: BaseObject[] = [];
        this._objects.sort(sortRules);
        for (const o of this._objects) {
            if (!(o.classType === RENDER_CLASS_TYPE.GROUP) && o.visible) {
                objects.push(o);
            }
        }
        return objects;
    }

    getObjects() {
        return this._objects;
    }

    addObject(o: BaseObject) {
        if (o.classType === RENDER_CLASS_TYPE.GROUP) {
            const objects = (o as BaseObject).getObjects();
            for (const object of objects) {
                if (this.scene.getObject(object.oKey)) {
                    continue;
                }
                this._objects.push(object);
                this.scene.setObjectBehavior(object);
                this._layerBehavior(object);
            }
        }
        this._objects.push(o);
        this.scene.setObjectBehavior(o);
        this._layerBehavior(o);
        this.scene.applyTransformer(o);

        return this;
    }

    removeObject(object: BaseObject | string) {
        const objects = this.getObjects();
        const objectsLength = objects.length;

        if (object instanceof BaseObject) {
            for (let i = 0; i < objectsLength; i++) {
                const o = objects[i];
                if (o === object) {
                    objects.splice(i, 1);
                    return;
                }
            }
        } else {
            for (let i = 0; i < objectsLength; i++) {
                const o = objects[i];
                if (o.oKey === object) {
                    objects.splice(i, 1);
                    return;
                }
            }
        }
    }

    addObjects(objects: BaseObject[]) {
        objects.forEach((o: BaseObject) => {
            this.addObject(o);
        });
        return this;
    }

    removeObjects(objects: BaseObject[] | string[]) {
        const allObjects = this.getObjects();
        const allObjectsLength = allObjects.length;

        for (let i = allObjectsLength - 1; i >= 0; i--) {
            let o: BaseObject | string = allObjects[i];
            const objectsLength = objects.length;

            if (objectsLength === 0) break;

            for (let j = 0; j < objectsLength; j++) {
                const object = objects[j];
                o = object instanceof BaseObject ? o : (o as BaseObject).oKey;
                if (o === object) {
                    allObjects.splice(i, 1);
                    // objects.splice(j, 1);
                    break;
                }
            }
        }
    }

    makeDirty(state: boolean = true) {
        this._dirty = state;

        /**
         * parent is SceneViewer, make it dirty
         */
        const parent = this.scene.getParent();
        if (parent.classType === RENDER_CLASS_TYPE.SCENE_VIEWER) {
            (parent as SceneViewer).makeDirty(true);
        }

        return this;
    }

    makeDirtyWithDebounce(state: boolean = true) {
        if (this._debounceDirtyFunc) {
            this._debounceDirtyFunc();
        }

        // To prevent multiple refreshes caused by setting values for multiple object instances at once.
        this._debounceDirtyFunc = requestImmediateMacroTask(() => {
            this.makeDirty(state);
            this._debounceDirtyFunc = null;
        });
    }

    isDirty(): boolean {
        return this._dirty;
    }

    render(parentCtx?: UniverRenderingContext, isMaxLayer = false) {
        const mainCtx = parentCtx || this._scene.getEngine()?.getCanvas().getContext();
        if (mainCtx) {
            if (this._allowCache && this._cacheCanvas) {
                if (this.isDirty()) {
                    const ctx = this._cacheCanvas.getContext();

                    this._cacheCanvas.clear();

                    ctx.save();

                    ctx.setTransform(mainCtx.getTransform());
                    this._draw(ctx, isMaxLayer);

                    ctx.restore();
                }
                this._applyCache(mainCtx);
            } else {
                mainCtx.save();
                this._draw(mainCtx, isMaxLayer);
                mainCtx.restore();
            }
        }

        this.makeDirty(false);
        return this;
    }

    private _layerBehavior(o: BaseObject) {
        this.disposeWithMe(
            toDisposable(
                o.onTransformChangeObservable.add(() => {
                    this.makeDirty(true);
                })
            )
        );

        o.layer = this;
    }

    private _initialCacheCanvas() {
        this._cacheCanvas = new Canvas();
        this.disposeWithMe(
            toDisposable(
                this._scene.getEngine()?.onTransformChangeObservable.add(() => {
                    this._resizeCacheCanvas();
                })
            )
        );
    }

    private _draw(mainCtx: UniverRenderingContext, isMaxLayer: boolean) {
        const viewports = this._scene.getViewports().filter((vp) => vp.shouldIntoRender());
        const objects = this.getObjectsByOrder();
        for (const [_index, vp] of viewports.entries()) {
            vp.render(mainCtx, objects, isMaxLayer);
        }
        objects.forEach((o) => {
            o.makeDirty(false);
            o.makeForceDirty?.(false);
        });
    }

    private _applyCache(ctx?: UniverRenderingContext) {
        if (!ctx || this._cacheCanvas == null) {
            return;
        }
        const width = this._cacheCanvas.getWidth();
        const height = this._cacheCanvas.getHeight();
        // it throw an error if canvas size is zero, and canvas size is zero when viewport isActive is false.
        if (width !== 0 && height !== 0) {
            ctx.drawImage(this._cacheCanvas.getCanvasEle(), 0, 0, width, height);
        }
    }

    private _resizeCacheCanvas() {
        const engine = this._scene.getEngine();
        if (engine) {
            this._cacheCanvas?.setSize(engine.width, engine.height);
        }
        this.makeDirty(true);
    }

    clear() {
        this._objects = [];
    }

    override dispose() {
        super.dispose();
        const objects = [...this.getObjects()];
        objects.forEach((o) => {
            o.dispose();
        });
        this.clear();

        this._debounceDirtyFunc = null;

        this._cacheCanvas?.dispose();
        this._cacheCanvas = null;
    }
}
