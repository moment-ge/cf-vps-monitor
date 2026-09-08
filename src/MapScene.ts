import * as THREE from "three";
import { globePosition } from "../shared/locations";
import {
  mapConnections,
  type LocationGroup,
  type NodeLevels,
  type MapStatus,
} from "./map-model";

const colors: Record<MapStatus, number> = {
  online: 0x35d69a,
  warning: 0xf4b54b,
  offline: 0xf36969,
  pending: 0x829aa4,
};

export function buildDistributionLayer(dark: boolean) {
  const group = new THREE.Group();
  type Connection = {
    curve: THREE.CatmullRomCurve3;
    marker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    phase: number;
    status: MapStatus;
  };
  let connections: Connection[] = [];
  const clear = () => {
    for (const child of [...group.children] as (THREE.Line | THREE.Mesh)[]) {
      group.remove(child);
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((material) => material.dispose());
    }
    connections = [];
  };
  return {
    group,
    update(
      locations: LocationGroup[],
      selectedKey: string,
      levels: NodeLevels,
    ) {
      clear();
      mapConnections(locations, selectedKey, levels).forEach(
        ({ origin, destination, status }, index) => {
          const start = new THREE.Vector3(
            ...globePosition(origin.latitude, origin.longitude),
          );
          const end = new THREE.Vector3(
            ...globePosition(destination.latitude, destination.longitude),
          );
          const angle = Math.acos(THREE.MathUtils.clamp(start.dot(end), -1, 1));
          // A perpendicular basis keeps even antipodal routes above the surface.
          const tangent = end.clone().addScaledVector(start, -Math.cos(angle));
          if (tangent.lengthSq() < 0.00001)
            tangent.crossVectors(
              start,
              Math.abs(start.y) < 0.9
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(1, 0, 0),
            );
          tangent.normalize();
          const points = Array.from({ length: 65 }, (_, i) => {
            const t = i / 64;
            return start
              .clone()
              .multiplyScalar(Math.cos(angle * t))
              .addScaledVector(tangent, Math.sin(angle * t))
              .multiplyScalar(
                1.018 + Math.sin(Math.PI * t) * Math.min(0.26, angle * 0.12),
              );
          });
          const curve = new THREE.CatmullRomCurve3(points);
          const color = new THREE.Color(colors[status]).multiplyScalar(
            dark ? 1 : 0.65,
          );
          const material =
            status === "offline" || status === "pending"
              ? new THREE.LineDashedMaterial({
                  color,
                  dashSize: 0.025,
                  gapSize: 0.025,
                  transparent: true,
                  opacity: 0.52,
                  depthWrite: false,
                })
              : new THREE.LineBasicMaterial({
                  color,
                  transparent: true,
                  opacity: 0.45,
                  depthWrite: false,
                });
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            material,
          );
          line.computeLineDistances();
          group.add(line);
          if (status === "pending") return;
          const marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.012, 8, 6),
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              depthWrite: false,
            }),
          );
          marker.position.copy(points[0]);
          group.add(marker);
          connections.push({ curve, marker, phase: index * 0.17, status });
        },
      );
    },
    tick(elapsed: number) {
      for (const { curve, marker, phase, status } of connections) {
        const t = (elapsed * (status === "offline" ? 0.13 : 0.2) + phase) % 1;
        marker.position.copy(curve.getPoint(t));
        marker.material.opacity =
          status === "offline"
            ? Math.sin(t * Math.PI * 10) > 0
              ? 0.9
              : 0.16
            : 0.95;
      }
    },
    dispose: clear,
  };
}

export function buildGlobeGrid(
  contours: readonly (readonly (readonly [number, number])[])[],
  dark: boolean,
) {
  const vertices: number[] = [];
  const segment = (
    a: readonly [number, number],
    b: readonly [number, number],
    radius: number,
  ) => {
    vertices.push(
      ...globePosition(a[0], a[1], radius),
      ...globePosition(b[0], b[1], radius),
    );
  };
  for (const contour of contours)
    for (let i = 1; i < contour.length; i++)
      segment(contour[i - 1], contour[i], 1.003);
  const coastline = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    ),
    new THREE.LineBasicMaterial({
      color: dark ? 0x78b1b4 : 0x3b858a,
      transparent: true,
      opacity: dark ? 0.3 : 0.22,
      depthWrite: false,
    }),
  );
  vertices.length = 0;
  for (let lat = -60; lat <= 60; lat += 30)
    for (let lon = -180; lon < 180; lon += 3)
      segment([lat, lon], [lat, lon + 3], 1.005);
  for (let lon = -180; lon < 180; lon += 30)
    for (let lat = -90; lat < 90; lat += 3)
      segment([lat, lon], [lat + 3, lon], 1.005);
  const grid = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    ),
    new THREE.LineBasicMaterial({
      color: dark ? 0x79a7af : 0x588a91,
      transparent: true,
      opacity: dark ? 0.14 : 0.12,
      depthWrite: false,
    }),
  );
  const group = new THREE.Group();
  group.add(coastline, grid);
  return {
    group,
    dispose() {
      for (const line of [coastline, grid]) {
        line.geometry.dispose();
        line.material.dispose();
      }
    },
  };
}
