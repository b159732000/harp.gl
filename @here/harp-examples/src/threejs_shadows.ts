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
    ThemeLoader,
    MapViewUtils
} from "@here/harp-mapview";
import { APIFormat, OmvDataSource } from "@here/harp-omv-datasource";
import { GUI } from "dat.gui";
import { ShadowMapViewer } from "three/examples/jsm/utils/ShadowMapViewer";
import { accessToken } from "../config";
import { Vector3, BufferAttribute } from "three";

let shadowMapViewerCreated = false;

const updateLightCamera = (map: MapView, light: THREE.DirectionalLight, options: any) => {
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
    const lightPos = light.position;
    const divider = 1;
    lightPos.setX(options.xpos / divider);
    lightPos.setY(options.ypos / divider);
    lightPos.setZ(options.zpos / divider);
    map.update();
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

const positions: number[] = new Array<number>(24 * 2);
const pointsGeo = new THREE.BufferGeometry();
pointsGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
const material = new THREE.PointsMaterial({
    size: 45,
    color: new THREE.Color("#ff0000")
});
const points = new THREE.Points(pointsGeo, material);

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

        const ch = new THREE.CameraHelper(map["m_rteCamera"]);
        // Enable to see the camera in relation to the shadow camera.
        //map.scene.add(ch);
        map.scene.add(points);

        addOmvDataSource(map);

        map.update();

        map.addEventListener(MapViewEventNames.Render, _ => {
            if (map.pointOfView !== undefined) {
                ch.update();
            }
            const NDCToView = (x: number, y: number, z: number) => {
                return (
                    new THREE.Vector3(x, y, z)
                        .applyMatrix4(map.camera.projectionMatrixInverse)
                        // Make sure to apply rotation.
                        .applyMatrix4(map["m_rteCamera"].matrixWorld)
                );
            };
            const ViewToLightSpace = (worldPos: THREE.Vector3, camera: THREE.Camera) => {
                return worldPos.applyMatrix4(camera.matrixWorldInverse);
            };
            const target = MapViewUtils.getWorldTargetFromCamera(map.camera, map.projection);
            if (target === null) {
                return;
            }
            const normal = map.projection.surfaceNormal(target, new Vector3());
            // Should point down.
            normal.multiplyScalar(-1);
            // Consider perf optimization.
            //const toTarget = target.clone().sub(map.camera.position);
            // const distanceToTarget = toTarget.length();
            //const cameraDirection = map.camera.getWorldDirection(new Vector3());
            const tilt = MapViewUtils.extractCameraTilt(map.camera, map.projection);
            const cameraHeight = map.targetDistance * Math.cos(tilt);

            map.scene.children.forEach((obj: THREE.Object3D) => {
                if ((obj as any).isDirectionalLight) {
                    const light = obj as THREE.DirectionalLight;
                    const w = 1;
                    const h = 1;

                    const viewn1 = NDCToView(-w, -h, -1);
                    const viewn2 = NDCToView(w, -h, -1);
                    const viewn3 = NDCToView(-w, h, -1);
                    const viewn4 = NDCToView(w, h, -1);

                    // far
                    const viewf1 = NDCToView(-w, -h, 1);
                    const viewf2 = NDCToView(w, -h, 1);
                    const viewf3 = NDCToView(-w, h, 1);
                    const viewf4 = NDCToView(w, h, 1);

                    const frustumPointsView = [
                        viewn1,
                        viewn2,
                        viewn3,
                        viewn4,
                        viewf1,
                        viewf2,
                        viewf3,
                        viewf4
                    ];
                    const boxview = new THREE.Box3();

                    const positions_ = pointsGeo.attributes.position.array as any;
                    let i = 0;
                    frustumPointsView.forEach(point => {
                        boxview.expandByPoint(point);

                        positions_[i++] = point.x;
                        positions_[i++] = point.y;
                        positions_[i++] = point.z;
                    });
                    (pointsGeo.attributes.position as BufferAttribute).needsUpdate = true;

                    // set the orthographic bounds based on the camera.
                    // near
                    const n1 = ViewToLightSpace(viewn1, light.shadow.camera);
                    const n2 = ViewToLightSpace(viewn2, light.shadow.camera);
                    const n3 = ViewToLightSpace(viewn3, light.shadow.camera);
                    const n4 = ViewToLightSpace(viewn4, light.shadow.camera);

                    // far
                    const f1 = ViewToLightSpace(viewf1, light.shadow.camera);
                    const f2 = ViewToLightSpace(viewf2, light.shadow.camera);
                    const f3 = ViewToLightSpace(viewf3, light.shadow.camera);
                    const f4 = ViewToLightSpace(viewf4, light.shadow.camera);

                    const frustumPoints = [n1, n2, n3, n4, f1, f2, f3, f4];
                    const box = new THREE.Box3();
                    frustumPoints.forEach(point => {
                        box.expandByPoint(point);

                        positions_[i++] = point.x;
                        positions_[i++] = point.y;
                        positions_[i++] = point.z;
                    });

                    options.left = box.min.x;
                    options.right = box.max.x;
                    options.top = box.max.y;
                    options.bottom = box.min.y;
                    options.near = -box.max.z;
                    options.far = -box.min.z;
                    Object.assign(light.shadow.camera, options);
                    light.shadow.camera.updateProjectionMatrix();
                    const direction = new Vector3();
                    direction.copy(light.target.position);
                    direction.sub(light.position);
                    direction.normalize();
                    const lightPosHyp = cameraHeight / normal.clone().dot(direction);
                    light.target.position.copy(target).sub(map.camera.position);
                    // Consider adding the light.target to the scene to make this automatic.
                    light.position.copy(target);
                    light.position.addScaledVector(direction, -lightPosHyp);
                    light.position.sub(map.camera.position);

                    light.target.updateMatrixWorld();
                    light.updateMatrixWorld(); // needed?
                    light.shadow.updateMatrices(light);
                    if (light.userData !== undefined && light.userData.helper !== undefined)
                        (light.userData.helper as THREE.CameraHelper).update();
                    //frustum.setFromMatrix(map.camera.projectionMatrix);
                    //light.shadow.camera.projectionMatrix = map.camera.projectionMatrix;
                    //light.shadow.camera.updateProjectionMatrix();
                    /*const pos = light.target.position;
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
                    light.shadow.updateMatrices(light);*/
                    //console.log("done");
                    // updateLightCamera(map, light, options);
                }
            });
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
                    const light = obj as THREE.DirectionalLight;
                    light.userData = {
                        helper: new THREE.CameraHelper(
                            (obj as THREE.DirectionalLight).shadow.camera
                        )
                    };
                    // Enable to debug the shadow camera
                    //map.scene.add(light.userData.helper);
                }
            });
            map.update();
        });

        const gui = new GUI({ width: 300 });
        gui.add(options, "xpos", -2000, 2000).onChange(updateLights);
        gui.add(options, "ypos", -2000, 2000).onChange(updateLights);
        gui.add(options, "zpos", -2000, 2000).onChange(updateLights);
        // gui.add(options, "xtar", -100, 100).onChange(updateLights);
        // gui.add(options, "ytar", -100, 100).onChange(updateLights);
        // gui.add(options, "ztar", -2000, 100).onChange(updateLights);

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
    });
}
