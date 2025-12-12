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

vec3 computeSunTint(vec3 upDir, vec3 lightDir) {
    float sunHeight = clamp(dot(upDir, lightDir), -1.0, 1.0);

    // Transition smoothly from a cool night hue to a warmer daylight tint,
    // with a pronounced golden boost near the horizon.
    float dayFactor = smoothstep(-0.22, 0.1, sunHeight);
    float horizonWarmth = smoothstep(0.0, 0.35, 1.0 - abs(sunHeight)) * dayFactor;

    vec3 nightColor = vec3(0.03, 0.07, 0.12);
    vec3 dayColor = vec3(0.28, 0.52, 0.74);
    vec3 goldenColor = vec3(1.1, 0.65, 0.38);

    vec3 warmBlend = mix(dayColor, goldenColor, horizonWarmth);
    return mix(nightColor, warmBlend, dayFactor);
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
    float horizonDot = clamp(dot(rayDir, normalize(rayOrigin)), -1.0, 1.0);
    float horizonFactor = pow(clamp(1.0 - abs(horizonDot), 0.0, 1.0), 4.0);

    float sunFacing = dot(normalize(rayOrigin + rayDir * max(segment.x, 0.0)), lightDir);
    float sunVisibility = smoothstep(-0.08, 0.12, sunFacing);
    float mieForward = pow(max(dot(rayDir, lightDir), 0.0), 4.0) * sunVisibility;

    float pathFactor = smoothstep(0.0, atmThickness, pathLength);
    float density = (0.28 + 0.55 * (1.0 - altitudeNorm)) * pathFactor;

    float scatter = horizonFactor * altitudeFalloff * density * sunVisibility * 0.82;
    scatter += mieForward * 0.08;

    vec3 sunTint = computeSunTint(normalize(rayOrigin), lightDir);
    vec3 horizonTint = mix(sunTint, vec3(0.22, 0.3, 0.45), clamp(1.0 - sunVisibility, 0.0, 1.0));
    vec3 atmosphereColor = mix(vec3(0.08, 0.12, 0.18), horizonTint, clamp(0.2 + horizonFactor, 0.0, 1.0));
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
    float transmittance = exp(-opticalDepth * 0.55);

    FragColor = vec4(atmosphere, clamp(transmittance, 0.0, 1.0));
}
