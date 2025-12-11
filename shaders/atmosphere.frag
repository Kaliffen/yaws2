#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;

uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform float planetRadius;
uniform float atmosphereRadius;
uniform float aspect;

vec3 decodePosition(vec2 uv) {
    return texture(gPositionHeight, uv).xyz;
}

vec4 decodeNormalFlags(vec2 uv) {
    return texture(gNormalFlags, uv);
}

vec3 rayDirection(vec2 uv) {
    uv = uv * 2.0 - 1.0;
    uv.x *= aspect;
    return normalize(camForward + uv.x * camRight + uv.y * camUp);
}

bool intersectSphere(vec3 ro, vec3 rd, float R, out float t0, out float t1) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - R * R;
    float h = b * b - c;
    if (h < 0.0) return false;
    h = sqrt(h);
    t0 = -b - h;
    t1 = -b + h;
    return true;
}

vec2 rayAtmosphereSegment(vec3 rayOrigin, vec3 rayDir, float hitDistance) {
    float t0, t1;
    if (!intersectSphere(rayOrigin, rayDir, atmosphereRadius, t0, t1) || t1 <= 0.0) {
        return vec2(-1.0);
    }

    if (t0 < 0.0) {
        t0 = 0.0;
    }

    float maxTravel = (hitDistance > 0.0) ? min(hitDistance, t1) : t1;
    return vec2(t0, maxTravel);
}

vec3 computeAtmosphere(vec3 rayOrigin, vec3 rayDir, vec3 hitPos, bool hitSurface) {
    vec2 segment = rayAtmosphereSegment(rayOrigin, rayDir, hitSurface ? length(hitPos - rayOrigin) : -1.0);
    if (segment.x < 0.0) {
        return vec3(0.0);
    }

    float pathLength = segment.y - segment.x;
    float viewHeight = max(length(rayOrigin) - planetRadius, 0.0);
    float atmThickness = max(atmosphereRadius - planetRadius, 0.001);
    float altitudeNorm = clamp(viewHeight / atmThickness, 0.0, 1.0);
    float altitudeFalloff = mix(1.0, 0.25, altitudeNorm * altitudeNorm);

    vec3 lightDir = normalize(sunDir);
    float horizonDot = dot(rayDir, normalize(rayOrigin));
    // Treat inward-facing rays like horizon views so orbital vantage points still
    // accumulate visible scatter instead of being clamped away by the absolute
    // value. Only suppress the factor when looking away from the planet.
    float horizonFactor = pow(clamp(1.0 - max(horizonDot, 0.0), 0.0, 1.0), 3.5);

    float sunFacing = dot(normalize(rayOrigin + rayDir * max(segment.x, 0.0)), lightDir);
    float sunWrap = clamp(sunFacing * 0.6 + 0.4, 0.0, 1.0);
    float mieForward = pow(max(dot(rayDir, lightDir), 0.0), 4.0);

    float pathFactor = smoothstep(0.0, atmThickness, pathLength);
    float density = (0.35 + 0.65 * (1.0 - altitudeNorm)) * pathFactor;

    float scatter = horizonFactor * (0.22 + 0.78 * sunWrap) * altitudeFalloff * density;
    scatter += mieForward * 0.08 * sunWrap;
    scatter = max(scatter, 0.02 * pathFactor);

    vec3 atmosphereColor = vec3(0.32, 0.58, 0.96);
    return atmosphereColor * scatter;
}

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    vec4 normalFlags = decodeNormalFlags(uv);
    bool hit = normalFlags.w > -0.5;

    vec3 viewDir = hit ? normalize(pos - camPos) : rayDirection(uv);
    vec3 atmosphere = computeAtmosphere(camPos, viewDir, pos, hit);

    float opticalDepth = length(atmosphere);
    float transmittance = exp(-opticalDepth * 0.65);

    FragColor = vec4(atmosphere, clamp(transmittance, 0.0, 1.0));
}
