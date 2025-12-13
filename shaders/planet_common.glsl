// Common terrain utilities shared between shaders

float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    float n000 = hash(i + vec3(0,0,0));
    float n001 = hash(i + vec3(0,0,1));
    float n010 = hash(i + vec3(0,1,0));
    float n011 = hash(i + vec3(0,1,1));
    float n100 = hash(i + vec3(1,0,0));
    float n101 = hash(i + vec3(1,0,1));
    float n110 = hash(i + vec3(1,1,0));
    float n111 = hash(i + vec3(1,1,1));
    vec3 u = f*f*(3.0 - 2.0*f);
    return mix(
        mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
        mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
        u.z
    );
}

float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

float terrainHeight(vec3 p, float planetRadius, float heightScale) {
    vec3 scaledP = p / planetRadius;

    float warpFreq = 1.15;
    float warpAmp = 0.06;

    vec3 warp = vec3(
        fbm(scaledP * warpFreq + vec3(11.7)),
        fbm(scaledP * warpFreq + vec3(3.9, 17.2, 5.1)),
        fbm(scaledP * warpFreq - vec3(7.5))
    );

    vec3 warpedP = scaledP * 8.0 + (warp - 0.5) * 2.0 * warpAmp;

    float base = fbm(warpedP);
    float detail = fbm(warpedP * 2.5) * 0.35;

    float normalized = base * 0.62 + detail * 0.38;
    return (normalized - 0.42) * heightScale;
}

float planetSDF(vec3 p, float planetRadius, float heightScale) {
    float r = length(p);
    float h = terrainHeight(p, planetRadius, heightScale);
    return r - (planetRadius + h);
}

vec3 computeNormal(vec3 p, float d0, float planetRadius, float heightScale) {
    float eps = max(planetRadius * 0.0005, heightScale * 0.03);
    float dx = planetSDF(p + vec3(eps,0,0), planetRadius, heightScale) - d0;
    float dy = planetSDF(p + vec3(0,eps,0), planetRadius, heightScale) - d0;
    float dz = planetSDF(p + vec3(0,0,eps), planetRadius, heightScale) - d0;
    return normalize(vec3(dx, dy, dz));
}
