/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from "three";
import "three/examples/js/controls/TrackballControls";

import {
    isLiteralDefinition,
    Style,
    StyleDeclaration,
    Theme,
    DirectionalLight
} from "@here/harp-datasource-protocol";
import { isJsonExpr } from "@here/harp-datasource-protocol/lib/Expr";
import { GeoCoordinates } from "@here/harp-geoutils";
import { MapControls, MapControlsUI, CameraRotationAnimation } from "@here/harp-map-controls";
import {
    CopyrightElementHandler,
    CopyrightInfo,
    MapView,
    MapViewEventNames,
    ThemeLoader
} from "@here/harp-mapview";
import { APIFormat, OmvDataSource } from "@here/harp-omv-datasource";
import { GUI } from "dat.gui";
import { ShadowMapViewer } from "three/examples/jsm/utils/ShadowMapViewer";
import { accessToken } from "../config";

let shadowMapViewerCreated = false;

const updateLightCamera = (map: MapView, light: THREE.DirectionalLight, options: any) => {
    const NDCToView = (x: number, y: number, z: number) => {
        return new THREE.Vector3(x, y, z).applyMatrix4(map.camera.projectionMatrixInverse);
    };
    // set the orthographic bounds based on the camera.
    const n1 = NDCToView(-1, -1, -1);
    const f4 = NDCToView(1, 1, 1);
    options.left = -f4.x;
    options.right = f4.x;
    options.top = f4.y;
    options.bottom = -f4.y;
    options.near = -n1.z + options.zpos;
    options.far = -f4.z + options.zpos;
    Object.assign(light.shadow.camera, options);

    if (shadowMapViewerCreated === false) {
        shadowMapViewerCreated = true;
        const lightShadowMapViewer = new ShadowMapViewer(light) as any;
        lightShadowMapViewer.position.x = 10;
        lightShadowMapViewer.position.y = 10;
        lightShadowMapViewer.size.width = 4096 / 16;
        lightShadowMapViewer.size.height = 4096 / 16;
        lightShadowMapViewer.update();
        map.addEventListener(MapViewEventNames.AfterRender, () => {
            lightShadowMapViewer.render(map.renderer);
        });
    }

    const targetPos = light.target.position;
    const divider = 1;
    targetPos.setX(options.xtar / divider);
    targetPos.setY(options.ytar / divider);
    targetPos.setZ(options.ztar / divider);
    light.target.updateMatrixWorld();
    const lightPos = light.position;
    lightPos.setX(options.xpos / divider);
    lightPos.setY(options.ypos / divider);
    lightPos.setZ(options.zpos / divider);
    light.updateMatrixWorld();
    light.shadow.updateMatrices(light);
};

const options = {
    top: 100,
    left: -100,
    right: 100,
    bottom: -100,
    far: 100,
    near: 0,
    xpos: 100,
    ypos: 0,
    zpos: -1700,
    xtar: 0,
    ytar: 0,
    ztar: -2000
};

const swapCamera = (
    mapControls: MapControls,
    trackBall: any,
    map: MapView,
    debugCamera: THREE.PerspectiveCamera
) => {
    mapControls.enabled = !mapControls.enabled;
    trackBall.enabled = !trackBall.enabled;
    map.pointOfView = mapControls.enabled ? undefined : debugCamera;
};

export namespace ThreejsShadows {
    function initializeMapView(id: string, theme: Theme): MapView {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        const map = new MapView({
            canvas,
            theme,
            enableShadows: true
        });
        map.renderLabels = false;

        CopyrightElementHandler.install("copyrightNotice", map);

        const mapControls = new MapControls(map);
        mapControls.maxTiltAngle = 50;

        const NY = new GeoCoordinates(40.707, -74.01);
        map.lookAt(NY, 2000, 0, 0);
        const ui = new MapControlsUI(mapControls);
        canvas.parentElement!.appendChild(ui.domElement);
        map.resize(window.innerWidth, window.innerHeight);

        window.addEventListener("resize", () => {
            map.resize(window.innerWidth, window.innerHeight);
        });

        addOmvDataSource(map);

        map.update();

        let frustum = new THREE.Frustum();
        map.addEventListener(MapViewEventNames.Render, _ => {
            /*map.scene.children.forEach((obj: THREE.Object3D) => {
                if ((obj as any).isDirectionalLight) {
                    const light = obj as THREE.DirectionalLight;
                    //frustum.setFromMatrix(map.camera.projectionMatrix);
                    light.shadow.camera.projectionMatrix = map.camera.projectionMatrix;
                    //light.shadow.camera.updateProjectionMatrix();
                    const pos = light.target.position;
                    const divider = 1;
                    pos.setX(options.xtar / divider);
                    pos.setY(options.ytar / divider);
                    pos.setZ(options.ztar / divider);
                    light.target.updateMatrixWorld();
                    const lightPos = light.position;
                    lightPos.setX(options.xpos / divider);
                    lightPos.setY(options.ypos / divider);
                    lightPos.setZ(options.zpos / divider);
                    light.updateMatrixWorld();
                    light.shadow.updateMatrices(light);
                    //console.log("done");
                    // updateLightCamera(map, light, options);
                }
            });*/
        });

        const m_debugCamera = new THREE.PerspectiveCamera(
            map.camera.fov,
            map.canvas.width / map.canvas.height,
            0.1,
            100000
        ); // use an arbitrary large distance for the far plane.

        map.scene.add(m_debugCamera);

        m_debugCamera.position.set(0, 0, 10);

        const m_trackball = new (THREE as any).TrackballControls(m_debugCamera, map.canvas);
        m_trackball.enabled = false;

        m_trackball.addEventListener("start", () => {
            map.beginAnimation();
        });
        m_trackball.addEventListener("end", () => {
            map.endAnimation();
        });
        m_trackball.addEventListener("change", () => {
            map.update();
        });
        // Update the debug controls.
        map.addEventListener(MapViewEventNames.Render, () => {
            if (m_trackball !== undefined) {
                m_trackball.update();
            }
        });

        window.addEventListener("keypress", event => {
            if (event.key === "s") {
                swapCamera(mapControls, m_trackball, map, m_debugCamera);
                map.update();
            }
        });

        return map;
    }

    function addOmvDataSource(map: MapView) {
        const hereCopyrightInfo: CopyrightInfo = {
            id: "here.com",
            year: new Date().getFullYear(),
            label: "HERE",
            link: "https://legal.here.com/terms"
        };
        const copyrights: CopyrightInfo[] = [hereCopyrightInfo];

        const omvDataSource = new OmvDataSource({
            baseUrl: "https://xyz.api.here.com/tiles/herebase.02",
            apiFormat: APIFormat.XYZOMV,
            styleSetName: "tilezen",
            maxZoomLevel: 17,
            authenticationCode: accessToken,
            copyrightInfo: copyrights
        });

        const promise = map.addDataSource(omvDataSource);

        map.renderer.shadowMap.enabled = true;
        map.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        const updateLights = () => {
            map.scene.children.forEach((obj: THREE.Object3D) => {
                if ((obj as any).isDirectionalLight) {
                    const light = obj as THREE.DirectionalLight;
                    updateLightCamera(map, light, options);
                }
            });
            map.update();
        };
        promise.then(updateLights).then(() => {
            map.scene.children.forEach((obj: THREE.Object3D) => {
                if ((obj as any).isDirectionalLight) {
                    map.scene.add(
                        new THREE.CameraHelper((obj as THREE.DirectionalLight).shadow.camera)
                    );
                }
            });
            map.update();
        });

        const gui = new GUI({ width: 300 });
        gui.add(options, "xpos", -100, 100).onChange(updateLights);
        gui.add(options, "ypos", -100, 100).onChange(updateLights);
        gui.add(options, "zpos", -2000, 100).onChange(updateLights);
        gui.add(options, "xtar", -100, 100).onChange(updateLights);
        gui.add(options, "ytar", -100, 100).onChange(updateLights);
        gui.add(options, "ztar", -2000, 100).onChange(updateLights);

        return map;
    }

    function patchFillStyle(styleDeclaration: StyleDeclaration) {
        if (!isJsonExpr(styleDeclaration)) {
            const style = styleDeclaration as Style;
            if (style.technique === "fill") {
                (style as any).technique = "standard";
                // ((style as any) as StandardStyle).attr!.roughness = 1.0;
            }
        }
    }

    /**
     * Replace all occurences of "fill" technique in the theme with "standard" technique.
     * "standard" technique is using three.js MeshStandardMaterial and is needed to receive
     * shadows.
     * @param theme The theme to patch
     */
    function patchTheme(theme: Theme) {
        theme.lights = [
            {
                type: "ambient",
                color: "#ffffff",
                name: "ambientLight",
                intensity: 0.9
            },
            {
                type: "directional",
                color: "#ffcccc",
                name: "light1",
                intensity: 1,
                direction: {
                    x: 0,
                    y: 0.1,
                    z: 1
                },
                castShadow: true
            }
        ];
        if (theme.styles === undefined || theme.styles.tilezen === undefined) {
            throw Error("Theme has no tilezen styles");
        }

        if (theme.definitions !== undefined) {
            for (const definitionName in theme.definitions) {
                if (!theme.definitions.hasOwnProperty(definitionName)) {
                    continue;
                }
                const definition = theme.definitions[definitionName];
                if (!isLiteralDefinition(definition)) {
                    const styleDeclaration = definition as StyleDeclaration;
                    patchFillStyle(styleDeclaration);
                }
            }
        }
        theme.styles.tilezen.forEach((styleDeclaration: StyleDeclaration) => {
            patchFillStyle(styleDeclaration);
        });
    }

    ThemeLoader.load("resources/berlin_tilezen_base.json").then((theme: Theme) => {
        patchTheme(theme);
        initializeMapView("mapCanvas", theme);
    });
}
