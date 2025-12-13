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

const float PI = 3.14159265359;
// Distances in the engine are expressed in kilometers. Use kilometer-based
// scale heights and scattering coefficients so optical depth math remains
// physically reasonable and produces visible sky color.
const float RAYLEIGH_SCALE_HEIGHT = 8.0;
const float MIE_SCALE_HEIGHT = 1.2;
const float HG_G = 0.76;
const vec3 BETA_RAYLEIGH = vec3(5.8e-3, 13.5e-3, 33.1e-3);
const vec3 BETA_MIE = vec3(2.1e-2);

vec3 decodePosition(vec2 uv) {
    return texture(gPositionHeight, uv).xyz;
}

vec4 decodeNormalFlags(vec2 uv) {
    return texture(gNormalFlags, uv);
}

vec3 decodeViewData(vec2 uv) {
    return texture(gViewData, uv).xyz;
}

float rayleighPhase(float cosTheta) {
    return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

float hgPhase(float cosTheta) {
    float g2 = HG_G * HG_G;
    float denom = pow(1.0 + g2 - 2.0 * HG_G * cosTheta, 1.5);
    return (3.0 / (8.0 * PI)) * (1.0 - g2) * (1.0 + cosTheta * cosTheta) / (denom * (2.0 + g2));
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

vec3 integrateSunTransmittance(vec3 start, vec3 lightDir) {
    float t0, t1;
    if (!intersectSphere(start, lightDir, atmosphereRadius, t0, t1)) {
        return vec3(1.0);
    }

    float begin = max(t0, 0.0);
    float end = t1;
    const int SUN_STEPS = 8;
    float stepSize = (end - begin) / float(SUN_STEPS);

    float rayleighOD = 0.0;
    float mieOD = 0.0;
    for (int i = 0; i < SUN_STEPS; i++) {
        float t = begin + (float(i) + 0.5) * stepSize;
        vec3 samplePos = start + lightDir * t;
        float height = max(length(samplePos) - planetRadius, 0.0);
        rayleighOD += exp(-height / RAYLEIGH_SCALE_HEIGHT) * stepSize;
        mieOD += exp(-height / MIE_SCALE_HEIGHT) * stepSize;
    }

    return exp(-(BETA_RAYLEIGH * rayleighOD + BETA_MIE * mieOD));
}

vec4 computeAtmosphere(vec3 rayOrigin, vec3 rayDir, vec2 segment) {
    float pathLength = segment.y - segment.x;
    if (pathLength <= 0.0) {
        return vec4(0.0);
    }

    vec3 lightDir = normalize(worldToPlanet * sunDir);
    float cosTheta = dot(rayDir, lightDir);
    float phaseR = rayleighPhase(cosTheta);
    float phaseM = hgPhase(cosTheta);

    const int VIEW_STEPS = 28;
    float start = max(segment.x, 0.0);
    float stepSize = pathLength / float(VIEW_STEPS);

    vec2 opticalDepth = vec2(0.0);
    vec3 scattered = vec3(0.0);

    for (int i = 0; i < VIEW_STEPS; i++) {
        float t = start + (float(i) + 0.5) * stepSize;
        vec3 samplePos = rayOrigin + rayDir * t;
        float height = max(length(samplePos) - planetRadius, 0.0);
        float localRayleigh = exp(-height / RAYLEIGH_SCALE_HEIGHT);
        float localMie = exp(-height / MIE_SCALE_HEIGHT);

        vec2 stepOD = vec2(localRayleigh, localMie) * stepSize;
        opticalDepth += stepOD;

        vec3 transView = exp(-(BETA_RAYLEIGH * opticalDepth.x + BETA_MIE * opticalDepth.y));
        vec3 transSun = integrateSunTransmittance(samplePos, lightDir);

        vec3 scatterCoeff = localRayleigh * BETA_RAYLEIGH * phaseR + localMie * BETA_MIE * phaseM;
        scattered += scatterCoeff * transSun * transView * stepSize;
    }

    float sunIntensity = max(sunPower, 0.0);
    scattered *= sunIntensity;

    vec3 transmittanceRGB = exp(-(BETA_RAYLEIGH * opticalDepth.x + BETA_MIE * opticalDepth.y));
    float transmittance = clamp((transmittanceRGB.r + transmittanceRGB.g + transmittanceRGB.b) / 3.0, 0.0, 1.0);

    return vec4(scattered, transmittance);
}

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    vec3 viewData = decodeViewData(uv);

    vec3 camPlanet = worldToPlanet * camPos;
    vec3 viewDirWorld = normalize(pos - camPos);
    vec3 viewDirPlanet = normalize(worldToPlanet * viewDirWorld);
    vec2 atmosphereSegment = viewData.yz;
    vec4 atmosphere = (atmosphereSegment.y > atmosphereSegment.x)
        ? computeAtmosphere(camPlanet, viewDirPlanet, atmosphereSegment)
        : vec4(0.0);

    FragColor = atmosphere;
}
