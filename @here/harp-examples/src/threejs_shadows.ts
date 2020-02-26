/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    isLiteralDefinition,
    Style,
    StyleDeclaration,
    Theme
} from "@here/harp-datasource-protocol";
import { isJsonExpr } from "@here/harp-datasource-protocol/lib/Expr";
import { GeoCoordinates, Vector3Like } from "@here/harp-geoutils";
import { MapControls, MapControlsUI } from "@here/harp-map-controls";
import {
    CopyrightElementHandler,
    CopyrightInfo,
    MapView,
    MapViewEventNames,
    MapViewUtils,
    ThemeLoader
} from "@here/harp-mapview";
import { APIFormat, OmvDataSource } from "@here/harp-omv-datasource";
import { GUI } from "dat.gui";
import * as THREE from "three";
import "three/examples/js/controls/TrackballControls";
import { ShadowMapViewer } from "three/examples/jsm/utils/ShadowMapViewer";
import { accessToken } from "../config";

let directionalLight: THREE.DirectionalLight;
let map: MapView;

const guiOptions = {
    xpos: 0,
    ypos: 0,
    zpos: 0
};

const swapCamera = (
    mapControls: MapControls,
    trackBall: any,
    debugCamera: THREE.PerspectiveCamera
) => {
    mapControls.enabled = !mapControls.enabled;
    trackBall.enabled = !trackBall.enabled;
    map.pointOfView = mapControls.enabled ? undefined : debugCamera;
};

const setupDebugCamera = (mapControls: MapControls) => {
    // tslint:disable-next-line: no-string-literal
    const mapCamera = new THREE.CameraHelper(map["m_rteCamera"]);
    map.scene.add(mapCamera);

    const debugCamera = new THREE.PerspectiveCamera(
        map.camera.fov,
        map.canvas.width / map.canvas.height,
        100,
        100000
    );
    map.scene.add(debugCamera);
    debugCamera.position.set(6000, 2000, 1000);

    const m_trackball = new (THREE as any).TrackballControls(debugCamera, map.canvas);
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

    // Update the debug controls before rendering.
    map.addEventListener(MapViewEventNames.Render, () => {
        if (m_trackball !== undefined) {
            m_trackball.update();
        }
        const enableCameraHelpers = map.pointOfView !== undefined;
        if (enableCameraHelpers) {
            mapCamera.update();
            directionalLight?.userData.helper.update();
        }
        mapCamera.visible = enableCameraHelpers;
        if (directionalLight !== undefined && directionalLight.userData !== undefined) {
            directionalLight.userData.helper.visible = enableCameraHelpers;
        }
    });

    window.addEventListener("keypress", event => {
        if (event.key === "s") {
            swapCamera(mapControls, m_trackball, debugCamera);
            map.update();
        }
    });
};

const computeShadowFrustum = () => {
    if (directionalLight === undefined) {
        return;
    }

    const NDCToView = (vector: Vector3Like): THREE.Vector3 => {
        return (
            new THREE.Vector3(vector.x, vector.y, vector.z)
                .applyMatrix4(map.camera.projectionMatrixInverse)
                // Make sure to apply rotation, hence use the rte camera
                // tslint:disable-next-line: no-string-literal
                .applyMatrix4(map["m_rteCamera"].matrixWorld)
        );
    };
    const ViewToLightSpace = (worldPos: THREE.Vector3, camera: THREE.Camera): THREE.Vector3 => {
        return worldPos.applyMatrix4(camera.matrixWorldInverse);
    };
    const points: Vector3Like[] = [
        // near plane points
        { x: -1, y: -1, z: -1 },
        { x: 1, y: -1, z: -1 },
        { x: -1, y: 1, z: -1 },
        { x: 1, y: 1, z: -1 },

        // far planes points
        { x: -1, y: -1, z: 1 },
        { x: 1, y: -1, z: 1 },
        { x: -1, y: 1, z: 1 },
        { x: 1, y: 1, z: 1 }
    ];
    const transformedPoints = points
        .map(p => NDCToView(p))
        .map(p => ViewToLightSpace(p, directionalLight.shadow.camera));
    const box = new THREE.Box3();
    transformedPoints.forEach(point => {
        box.expandByPoint(point);
    });
    Object.assign(directionalLight.shadow.camera, {
        left: box.min.x,
        right: box.max.x,
        top: box.max.y,
        bottom: box.min.y,
        near: -box.max.z,
        far: -box.min.z
    });
    directionalLight.shadow.camera.updateProjectionMatrix();

    const lightDirection = new THREE.Vector3();
    lightDirection.copy(directionalLight.target.position);
    lightDirection.sub(directionalLight.position);
    lightDirection.normalize();

    const target = MapViewUtils.getWorldTargetFromCamera(map.camera, map.projection);
    if (target === null) {
        return;
    }
    const normal = map.projection.surfaceNormal(target, new THREE.Vector3());
    // Should point down.
    normal.multiplyScalar(-1);

    // The camera of the shadow has the same height as the map camera, and the target is also the
    // same. The position is then calculated based on the light direction and the height using basic
    // trigonometry.
    const tilt = MapViewUtils.extractCameraTilt(map.camera, map.projection);
    const cameraHeight = map.targetDistance * Math.cos(tilt);
    const lightPosHyp = cameraHeight / normal.clone().dot(lightDirection);

    directionalLight.target.position.copy(target).sub(map.camera.position);
    directionalLight.position.copy(target);
    directionalLight.position.addScaledVector(lightDirection, -lightPosHyp);
    directionalLight.position.sub(map.camera.position);
};

export namespace ThreejsShadows {
    function initializeMapView(id: string, theme: Theme): MapView {
        const canvas = document.getElementById(id) as HTMLCanvasElement;
        map = new MapView({
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

        addOmvDataSource();

        map.addEventListener(MapViewEventNames.Render, computeShadowFrustum);
        setupDebugCamera(mapControls);

        map.update();
        return map;
    }

    function addOmvDataSource() {
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
        promise.then(() => {
            map.scene.children.forEach((obj: THREE.Object3D) => {
                if ((obj as any).isDirectionalLight) {
                    if (directionalLight !== undefined) {
                        return;
                    }
                    // Keep reference to the light.
                    directionalLight = obj as THREE.DirectionalLight;
                    // Add the camera helper to help debug
                    directionalLight.userData = {
                        helper: new THREE.CameraHelper(
                            (obj as THREE.DirectionalLight).shadow.camera
                        )
                    };
                    map.scene.add(directionalLight.userData.helper);
                    // This is needed so that the target is updated automatically, see:
                    // https://threejs.org/docs/#api/en/lights/DirectionalLight.target
                    map.scene.add(directionalLight.target);
                    // Add the shadow map texture viewer
                    const lightShadowMapViewer = new ShadowMapViewer(directionalLight) as any;
                    lightShadowMapViewer.position.x = 10;
                    lightShadowMapViewer.position.y = 10;
                    lightShadowMapViewer.size.width = 4096 / 16;
                    lightShadowMapViewer.size.height = 4096 / 16;
                    lightShadowMapViewer.update();
                    map.addEventListener(MapViewEventNames.AfterRender, () => {
                        lightShadowMapViewer.render(map.renderer);
                    });
                }
            });
        });

        map.renderer.shadowMap.enabled = true;
        map.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        const updateLight = () => {
            if (directionalLight === undefined) {
                throw new Error("Missing directional light");
            }
            const lightPos = directionalLight.position;
            lightPos.setX(guiOptions.xpos);
            lightPos.setY(guiOptions.ypos);
            lightPos.setZ(guiOptions.zpos);
            map.update();
        };
        const gui = new GUI({ width: 300 });
        gui.add(guiOptions, "xpos", -2000, 2000).onChange(updateLight);
        gui.add(guiOptions, "ypos", -2000, 2000).onChange(updateLight);
        gui.add(guiOptions, "zpos", -2000, 2000).onChange(updateLight);

        return map;
    }

    function patchFillStyle(styleDeclaration: StyleDeclaration) {
        if (!isJsonExpr(styleDeclaration)) {
            const style = styleDeclaration as Style;
            if (style.technique === "fill") {
                (style as any).technique = "standard";
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
                    y: 0.01,
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

        const message = document.createElement("div");
        message.style.position = "absolute";
        message.style.cssFloat = "right";
        message.style.top = "120px";
        message.style.right = "10px";
        message.innerHTML = `Press 's' to toggle the debug camera.`;
        document.body.appendChild(message);
    });
}
