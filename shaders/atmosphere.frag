#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gViewData;

uniform vec3 camPos;
uniform vec3 camForward;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform float sunPower;
uniform float planetRadius;
uniform float atmosphereRadius;
uniform float aspect;
uniform mat3 worldToPlanet;

vec3 decodePosition(vec2 uv) {
    return texture(gPositionHeight, uv).xyz;
}

vec4 decodeNormalFlags(vec2 uv) {
    return texture(gNormalFlags, uv);
}

vec3 decodeViewData(vec2 uv) {
    return texture(gViewData, uv).xyz;
}

vec3 computeSunTint(vec3 upDir, vec3 lightDir) {
    float sunHeight = clamp(dot(upDir, lightDir), -1.0, 1.0);

    // Transition from a cool night hue to a tighter, warmer daylight band.
    float dayFactor = smoothstep(-0.08, 0.12, sunHeight);
    float goldenBand = 1.0 - smoothstep(0.01, 0.25, abs(sunHeight));

    vec3 nightColor = vec3(0.02, 0.06, 0.12);
    vec3 dayColor = vec3(0.26, 0.48, 0.70);
    vec3 goldenColor = vec3(0.98, 0.62, 0.36);
    vec3 twilightColor = vec3(0.30, 0.24, 0.46);

    vec3 warmBlend = mix(dayColor, goldenColor, goldenBand * 1.35);
    vec3 base = mix(nightColor, warmBlend, dayFactor);
    return mix(base, twilightColor, goldenBand * 0.18);
}

vec3 computeAtmosphere(vec3 rayOrigin, vec3 rayDir, vec3 hitPos, bool hitSurface, vec2 segment) {
    float pathLength = segment.y - segment.x;
    float viewHeight = max(length(rayOrigin) - planetRadius, 0.0);
    float atmThickness = max(atmosphereRadius - planetRadius, 0.001);
    float altitudeNorm = clamp(viewHeight / atmThickness, 0.0, 1.0);
    float altitudeFalloff = mix(1.0, 0.25, altitudeNorm * altitudeNorm);

    vec3 lightDir = normalize(worldToPlanet * sunDir);
    float sunFacing = dot(normalize(rayOrigin + rayDir * max(segment.x, 0.0)), lightDir);
    float sunVisibility = smoothstep(-0.08, 0.12, sunFacing);

    float horizonDot = clamp(dot(rayDir, normalize(rayOrigin)), -1.0, 1.0);

    // The previous approach weighted the scattering almost entirely toward the
    // horizon, which made rays that travel up through the atmosphere (toward
    // space) contribute almost nothing. The result was a harsh black band near
    // the top of the sky because the "horizonFactor" fell to zero when
    // horizonDot approached 1. To keep a soft sky even at steep angles, keep a
    // small baseline of scattering that grows toward the horizon. A second
    // issue: short atmosphere segments (at high altitude or near-grazing views)
    // had their scatter almost fully erased by the path-factor ramp, so add a
    // lift that keeps thin air lightly visible.
    float horizonFactor = pow(clamp(1.0 - abs(horizonDot), 0.0, 1.0), 4.0);
    float zenithLift = mix(0.12, 0.24, sunVisibility) * (1.0 - altitudeNorm * 0.55);
    float thinPathLift = mix(0.18, 0.06, altitudeNorm)
        * (1.0 - smoothstep(0.02 * atmThickness, 0.18 * atmThickness, pathLength));
    float scatterSpread = max(horizonFactor + zenithLift * 0.6, zenithLift);
    scatterSpread = max(scatterSpread, thinPathLift);
    float mieForward = pow(max(dot(rayDir, lightDir), 0.0), 4.0) * sunVisibility;

    float pathFactor = smoothstep(0.0, atmThickness, pathLength);
    float density = (0.32 + 0.55 * (1.0 - altitudeNorm)) * max(pathFactor, 0.12);

    float scatter = scatterSpread * altitudeFalloff * density * sunVisibility * 1.12;
    scatter += mieForward * 0.06;

    vec3 sunTint = computeSunTint(normalize(rayOrigin), lightDir);
    float twilightBlend = smoothstep(-0.32, 0.06, sunFacing) * (1.0 - sunVisibility);
    vec3 twilightTint = mix(vec3(0.16, 0.18, 0.30), vec3(0.30, 0.24, 0.46), twilightBlend);
    vec3 horizonTint = mix(sunTint, twilightTint, clamp(1.0 - sunVisibility, 0.0, 1.0));
    vec3 highAltTint = mix(vec3(0.08, 0.12, 0.18), vec3(0.18, 0.26, 0.36), horizonFactor);
    vec3 atmosphereColor = mix(highAltTint, horizonTint, clamp(0.28 + horizonFactor, 0.0, 1.0));
    float sunIntensity = max(sunPower, 0.0);
    return atmosphereColor * scatter * sunIntensity;
}

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    vec4 normalFlags = decodeNormalFlags(uv);
    bool hit = normalFlags.w > -0.5;
    vec3 viewData = decodeViewData(uv);

    vec3 camPlanet = worldToPlanet * camPos;
    vec3 posPlanet = worldToPlanet * pos;
    vec3 viewDirWorld = normalize(pos - camPos);
    vec3 viewDirPlanet = normalize(worldToPlanet * viewDirWorld);
    vec2 atmosphereSegment = viewData.yz;
    vec3 atmosphere = (atmosphereSegment.y > atmosphereSegment.x)
        ? computeAtmosphere(camPlanet, viewDirPlanet, posPlanet, hit, atmosphereSegment)
        : vec3(0.0);

    float opticalDepth = length(atmosphere);
    float transmittance = exp(-opticalDepth * 0.55);

    FragColor = vec4(atmosphere, clamp(transmittance, 0.0, 1.0));
}
