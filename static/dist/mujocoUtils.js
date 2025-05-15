import * as THREE from 'three';
import { Reflector } from './utils/Reflector.js';


/** Loads a scene for MuJoCo
 * @param {mujoco} mujoco This is a reference to the mujoco namespace object
 * @param {string} filename This is the name of the .xml file in the /working/ directory of the MuJoCo/Emscripten Virtual File System
 * @param {RoboPianistDemo} parent The three.js Scene Object to add the MuJoCo model elements to
 */
export async function loadSceneFromURL(mujoco, filename, parent) {

  console.log(mujoco.FS.analyzePath("/working/" + filename));

  // Load in the state from XML.
  parent.model = mujoco.Model.load_from_xml("/working/" + filename);
  parent.state = new mujoco.State(parent.model);
  parent.simulation = new mujoco.Simulation(parent.model, parent.state);

  let model = parent.model;
  let state = parent.state;
  let simulation = parent.simulation;

  console.log("!");
  console.log(model);
  console.log(model.names);
  console.log("!!");

  // Decode the null-terminated string names.
  let textDecoder = new TextDecoder("utf-8");
  let fullString = textDecoder.decode(model.names);
  let names = fullString.split(textDecoder.decode(new ArrayBuffer(1)));

  // Create the root object.
  let mujocoRoot = new THREE.Group();
  mujocoRoot.name = "MuJoCo Root"
  parent.scene.add(mujocoRoot);

  parent.camera.position.set(-0.41, 0.77, -0.75);
  parent.controls.target.set(0.08, -0.01, -0.05);
  parent.controls.update();

  /** @type {Object.<number, THREE.Group>} */
  let bodies = {};
  /** @type {Object.<number, THREE.BufferGeometry>} */
  let meshes = {};
  /** @type {THREE.Light[]} */
  let lights = [];

  // Default material definition.
  let material = new THREE.MeshPhysicalMaterial();
  material.color = new THREE.Color(1, 1, 1);

  // Loop through the MuJoCo geoms and recreate them in three.js.
  for (let g = 0; g < model.ngeom; g++) {
    // Only visualize geom groups up to 2 (same default behavior as simulate).
    if (!(model.geom_group[g] < 3)) { continue; }

    // Get the body ID and type of the geom.
    let b = model.geom_bodyid[g];
    let type = model.geom_type[g];
    let size = [
      model.geom_size[(g * 3) + 0],
      model.geom_size[(g * 3) + 1],
      model.geom_size[(g * 3) + 2]
    ];

    // Create the body if it doesn't exist.
    if (!(b in bodies)) {
      bodies[b] = new THREE.Group();
      bodies[b].name = names[b + 1];
      bodies[b].bodyID = b;
      bodies[b].has_custom_mesh = false;
    }

    // Set the default geometry. In MuJoCo, this is a sphere.
    let geometry = new THREE.SphereGeometry(size[0] * 0.5);
    if (type == mujoco.mjtGeom.mjGEOM_PLANE.value) {
      // Special handling for plane later.
    } else if (type == mujoco.mjtGeom.mjGEOM_HFIELD.value) {
      // TODO: Implement this.
    } else if (type == mujoco.mjtGeom.mjGEOM_SPHERE.value) {
      geometry = new THREE.SphereGeometry(size[0]);
    } else if (type == mujoco.mjtGeom.mjGEOM_CAPSULE.value) {
      geometry = new THREE.CapsuleGeometry(size[0], size[1] * 2.0, 20, 20);
    } else if (type == mujoco.mjtGeom.mjGEOM_ELLIPSOID.value) {
      geometry = new THREE.SphereGeometry(1); // Stretch this below
    } else if (type == mujoco.mjtGeom.mjGEOM_CYLINDER.value) {
      geometry = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2.0);
    } else if (type == mujoco.mjtGeom.mjGEOM_BOX.value) {
      geometry = new THREE.BoxGeometry(size[0] * 2.0, size[2] * 2.0, size[1] * 2.0);
    } else if (type == mujoco.mjtGeom.mjGEOM_MESH.value) {
      let meshID = model.geom_dataid[g];

      if (!(meshID in meshes)) {
        geometry = new THREE.BufferGeometry(); // TODO: Populate the Buffer Geometry with Generic Mesh Data

        let vertex_buffer = model.mesh_vert.subarray(
          model.mesh_vertadr[meshID] * 3,
          (model.mesh_vertadr[meshID] + model.mesh_vertnum[meshID]) * 3);
        for (let v = 0; v < vertex_buffer.length; v += 3) {
          //vertex_buffer[v + 0] =  vertex_buffer[v + 0];
          let temp = vertex_buffer[v + 1];
          vertex_buffer[v + 1] = vertex_buffer[v + 2];
          vertex_buffer[v + 2] = -temp;
        }

        let normal_buffer = model.mesh_normal.subarray(
          model.mesh_vertadr[meshID] * 3,
          (model.mesh_vertadr[meshID] + model.mesh_vertnum[meshID]) * 3);
        for (let v = 0; v < normal_buffer.length; v += 3) {
          //normal_buffer[v + 0] =  normal_buffer[v + 0];
          let temp = normal_buffer[v + 1];
          normal_buffer[v + 1] = normal_buffer[v + 2];
          normal_buffer[v + 2] = -temp;
        }

        let uv_buffer = model.mesh_texcoord.subarray(
          model.mesh_texcoordadr[meshID] * 2,
          (model.mesh_texcoordadr[meshID] + model.mesh_vertnum[meshID]) * 2);
        let triangle_buffer = model.mesh_face.subarray(
          model.mesh_faceadr[meshID] * 3,
          (model.mesh_faceadr[meshID] + model.mesh_facenum[meshID]) * 3);
        geometry.setAttribute("position", new THREE.BufferAttribute(vertex_buffer, 3));
        geometry.setAttribute("normal", new THREE.BufferAttribute(normal_buffer, 3));
        geometry.setAttribute("uv", new THREE.BufferAttribute(uv_buffer, 2));
        geometry.setIndex(Array.from(triangle_buffer));
        meshes[meshID] = geometry;
      } else {
        geometry = meshes[meshID];
      }

      bodies[b].has_custom_mesh = true;
    }
    // Done with geometry creation.

    // Set the Material Properties of incoming bodies
    let texture = undefined;
    let color = [
      model.geom_rgba[(g * 4) + 0],
      model.geom_rgba[(g * 4) + 1],
      model.geom_rgba[(g * 4) + 2],
      model.geom_rgba[(g * 4) + 3]];
    if (model.geom_matid[g] != -1) {
      let matId = model.geom_matid[g];
      color = [
        model.mat_rgba[(matId * 4) + 0],
        model.mat_rgba[(matId * 4) + 1],
        model.mat_rgba[(matId * 4) + 2],
        model.mat_rgba[(matId * 4) + 3]];

      // Construct Texture from model.tex_rgb
      texture = undefined;
      let texId = model.mat_texid[matId];
      if (texId != -1) {
        let width = model.tex_width[texId];
        let height = model.tex_height[texId];
        let offset = model.tex_adr[texId];
        let rgbArray = model.tex_rgb;
        let rgbaArray = new Uint8Array(width * height * 4);
        for (let p = 0; p < width * height; p++) {
          rgbaArray[(p * 4) + 0] = rgbArray[offset + ((p * 3) + 0)];
          rgbaArray[(p * 4) + 1] = rgbArray[offset + ((p * 3) + 1)];
          rgbaArray[(p * 4) + 2] = rgbArray[offset + ((p * 3) + 2)];
          rgbaArray[(p * 4) + 3] = 1.0;
        }
        texture = new THREE.DataTexture(rgbaArray, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
        if (texId == 2) {
          texture.repeat = new THREE.Vector2(50, 50);
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
        } else {
          texture.repeat = new THREE.Vector2(1, 1);
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
        }

        texture.needsUpdate = true;
      }
    }

    material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color[0], color[1], color[2]),
      transparent: color[3] < 1.0,
      opacity: color[3],
      specularIntensity: model.geom_matid[g] != -1 ? model.mat_specular[model.geom_matid[g]] * 0.5 : undefined,
      reflectivity: model.geom_matid[g] != -1 ? model.mat_reflectance[model.geom_matid[g]] : undefined,
      roughness: model.geom_matid[g] != -1 ? 1.0 - model.mat_shininess[model.geom_matid[g]] : undefined,
      metalness: model.geom_matid[g] != -1 ? 0.1 : undefined,
      map: texture
    });

    let mesh = new THREE.Mesh();
    if (type == 0) {
      mesh = new Reflector(new THREE.PlaneGeometry(100, 100), { clipBias: 0.003, texture: texture });
      mesh.rotateX(- Math.PI / 2);
    } else {
      mesh = new THREE.Mesh(geometry, material);
    }

    mesh.castShadow = g == 0 ? false : true;
    mesh.receiveShadow = type != 7;
    mesh.bodyID = b;
    bodies[b].add(mesh);
    getPosition(model.geom_pos, g, mesh.position);
    if (type != 0) { getQuaternion(model.geom_quat, g, mesh.quaternion); }
    if (type == 4) { mesh.scale.set(size[0], size[2], size[1]) } // Stretch the Ellipsoid
  }

  // Parse lights.
  for (let l = 0; l < model.nlight; l++) {
    let light = new THREE.SpotLight();
    if (model.light_directional[l]) {
      light = new THREE.DirectionalLight();
    } else {
      light = new THREE.SpotLight();
    }
    light.decay = model.light_attenuation[l] * 100;
    light.penumbra = 0.5;
    light.castShadow = true; // default false

    light.shadow.mapSize.width = 1024; // default
    light.shadow.mapSize.height = 1024; // default
    light.shadow.camera.near = 1; // default
    light.shadow.camera.far = 10; // default
    //bodies[model.light_bodyid()].add(light);
    if (bodies[0]) {
      bodies[0].add(light);
    } else {
      mujocoRoot.add(light);
    }
    lights.push(light);
  }

  for (let b = 0; b < model.nbody; b++) {
    //let parent_body = model.body_parentid[b];
    if (b == 0 || !bodies[0]) {
      if (bodies[b] instanceof THREE.Object3D) {
        console.log(bodies[b]);
        mujocoRoot.add(bodies[b]);
      }
      else {
        console.error(bodies[b]);
      }
    } else if (bodies[b]) {
      bodies[0].add(bodies[b]);
    } else {
      // console.log("Body without Geometry detected; adding to bodies", b, bodies[b]);
      bodies[b] = new THREE.Group(); bodies[b].name = names[b + 1]; bodies[b].bodyID = b; bodies[b].has_custom_mesh = false;
      bodies[0].add(bodies[b]);
    }
  }

  return [model, state, simulation, bodies, lights]
}


/** Access the vector at index, swizzle for three.js, and apply to the target THREE.Vector3
 * @param {Float32Array|Float64Array} buffer
 * @param {number} index
 * @param {THREE.Vector3} target */
export function getPosition(buffer, index, target, swizzle = true) {
  if (swizzle) {
    return target.set(
      buffer[(index * 3) + 0],
      buffer[(index * 3) + 2],
      -buffer[(index * 3) + 1]);
  } else {
    return target.set(
      buffer[(index * 3) + 0],
      buffer[(index * 3) + 1],
      buffer[(index * 3) + 2]);
  }
}

/** Access the quaternion at index, swizzle for three.js, and apply to the target THREE.Quaternion
 * @param {Float32Array|Float64Array} buffer
 * @param {number} index
 * @param {THREE.Quaternion} target */
export function getQuaternion(buffer, index, target, swizzle = true) {
  if (swizzle) {
    return target.set(
      -buffer[(index * 4) + 1],
      -buffer[(index * 4) + 3],
      buffer[(index * 4) + 2],
      -buffer[(index * 4) + 0]);
  } else {
    return target.set(
      buffer[(index * 4) + 0],
      buffer[(index * 4) + 1],
      buffer[(index * 4) + 2],
      buffer[(index * 4) + 3]);
  }
}

/** Converts this Vector3's Handedness to MuJoCo's Coordinate Handedness
 * @param {THREE.Vector3} target */
export function toMujocoPos(target) { return target.set(target.x, -target.z, target.y); }

/** Standard normal random number generator using Box-Muller transform */
export function standardNormal() {
  return Math.sqrt(-2.0 * Math.log(Math.random())) *
    Math.cos(2.0 * Math.PI * Math.random());
}

