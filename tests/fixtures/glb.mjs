// Builds a tiny, valid binary glTF (GLB): a coloured box, Y-up, metres.
// Used by the automated tests; no external model files are needed.
export function makeBoxGlb({ width = 8, height = 5, depth = 4, color = [0.95, 0.45, 0.1] } = {}) {
  const x = width / 2, z = depth / 2, y = height;
  // 6 faces x 4 vertices, with flat normals.
  const faces = [
    { n: [0, 0, 1], v: [[-x, 0, z], [x, 0, z], [x, y, z], [-x, y, z]] },
    { n: [0, 0, -1], v: [[x, 0, -z], [-x, 0, -z], [-x, y, -z], [x, y, -z]] },
    { n: [1, 0, 0], v: [[x, 0, z], [x, 0, -z], [x, y, -z], [x, y, z]] },
    { n: [-1, 0, 0], v: [[-x, 0, -z], [-x, 0, z], [-x, y, z], [-x, y, -z]] },
    { n: [0, 1, 0], v: [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]] },
    { n: [0, -1, 0], v: [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]] }
  ];
  const positions = new Float32Array(faces.flatMap((f) => f.v.flat()));
  const normals = new Float32Array(faces.flatMap((f) => [f.n, f.n, f.n, f.n].flat()));
  const indices = new Uint16Array(faces.flatMap((_, i) => [0, 1, 2, 0, 2, 3].map((k) => k + i * 4)));
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(normals.buffer), Buffer.from(indices.buffer)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const gltf = {
    asset: { version: "2.0", generator: "bcsir-3d-map test fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "box" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    buffers: [{ byteLength: binPadded.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength + normals.byteLength, byteLength: indices.byteLength, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: [-x, 0, -z], max: [x, y, z] },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" }
    ]
  };
  let json = Buffer.from(JSON.stringify(gltf), "utf8");
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binPadded.length, 8);
  const chunk = (data, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
  return Buffer.concat([header, chunk(json, 0x4e4f534a), chunk(binPadded, 0x004e4942)]);
}
