// import geoJSON from './NewRoadNetwork.json' assert { type: 'json' };
import { readFile } from 'fs/promises';

const geoJSON = JSON.parse(await readFile(new URL('./r2.json', import.meta.url), 'utf-8'));
const poiJSON = JSON.parse(await readFile(new URL('./pois.json', import.meta.url), 'utf-8'));


let pois = [];
poiJSON.features.forEach(feature => {
    if (feature.geometry && feature.geometry.type === "Point") {
      const [lon, lat] = feature.geometry.coordinates;
        pois.push({ lat, lon });
    }
  });


function buildGraph(geoJson) {
    const graph = new Map();
    
    geoJson.features.forEach(feature => {
        if (feature.geometry && feature.geometry.type === "MultiLineString") {
            let coords = feature.geometry.coordinates[0];
            coords = coords.map(coord => coord.map(c => c.toFixed(6))); // Round to 10 decimal places

            for (let i = 0; i < coords.length - 1; i++) {
                const nodeA = coords[i].join(",");
                const nodeB = coords[i + 1].join(",");
                const distance = Math.hypot(
                    parseFloat(coords[i + 1][0]) - parseFloat(coords[i][0]),
                    parseFloat(coords[i + 1][1]) - parseFloat(coords[i][1])
                );
                
                if (!graph.has(nodeA)) graph.set(nodeA, new Map());
                if (!graph.has(nodeB)) graph.set(nodeB, new Map());
                
                graph.get(nodeA).set(nodeB, distance);
                graph.get(nodeB).set(nodeA, distance); // Assuming bidirectional roads
            }
        }
    });
    
    return graph;
}

function dijkstra(graph, start, end) {
    const distances = new Map();
    const previous = new Map();
    const queue = new Set(graph.keys());
    
    graph.forEach((_, node) => distances.set(node, Infinity));
    distances.set(start, 0);
    
    while (queue.size) {
        let current = [...queue].reduce((a, b) => (distances.get(a) < distances.get(b) ? a : b));
        queue.delete(current);
        
        if (current === end) break;
        
        for (let [neighbor, weight] of graph.get(current) || []) {
            let alt = distances.get(current) + weight;
            if (alt < distances.get(neighbor)) {
                distances.set(neighbor, alt);
                previous.set(neighbor, current);
            }
        }
    }
    
    let path = [];
    let step = end;
    while (previous.has(step)) {
        path.unshift(step);
        step = previous.get(step);
    }
    if (path.length) path.unshift(start);
    return path.length ? path : null;
}

function isGraphConnected(graph) {
    if (graph.size === 0) return false;
    const visited = new Set();
    const nodes = [...graph.keys()];
    
    function dfs(node) {
        if (visited.has(node)) return;
        visited.add(node);
        for (let neighbor of graph.get(node).keys()) {
            dfs(neighbor);
        }
    }
    
    dfs(nodes[0]);
    return visited.size === graph.size;
}

function findConnectedComponents(graph) {
    const visited = new Set();
    const components = [];
    
    function dfs(node, component) {
        if (visited.has(node)) return;
        visited.add(node);
        component.push(node);
        for (let neighbor of graph.get(node).keys()) {
            dfs(neighbor, component);
        }
    }
    
    for (let node of graph.keys()) {
        if (!visited.has(node)) {
            const component = [];
            dfs(node, component);
            components.push(component);
        }
    }
    
    return components;
}


let graph = buildGraph(geoJSON);
let start = pois[0].lon.toFixed(6) + "," + pois[0].lat.toFixed(6);
let end = pois[1].lon.toFixed(6) + "," + pois[1].lat.toFixed(6);

// pair of pois and their shortest path
for (let i = 0; i < pois.length - 1; i++) {
    for (let j = i + 1; j < pois.length; j++) {
        let start = pois[i].lon.toFixed(6) + "," + pois[i].lat.toFixed(6);
        let end = pois[j].lon.toFixed(6) + "," + pois[j].lat.toFixed(6);
        let shortestPath = dijkstra(graph, start, end);
        if (!shortestPath) {
            console.log(pois[i], pois[j], "No path found");
        }
    }
}

console.log("Graph connected:", isGraphConnected(graph));
console.log(findConnectedComponents(graph));

// console.log("Shortest path:", dijkstra(graph, start, end));