#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;

uniform vec3 camPos;
uniform vec3 sunDir;
uniform float sunPower;
uniform float planetRadius;
uniform float seaLevel;
uniform vec3 waterColor;
uniform float waterAbsorption;
uniform float waterScattering;

vec3 decodePosition(vec2 uv) {
    return texture(gPositionHeight, uv).xyz;
}

float decodeHeight(vec2 uv) {
    return texture(gPositionHeight, uv).w;
}

vec4 decodeNormalFlags(vec2 uv) {
    return texture(gNormalFlags, uv);
}

vec3 decodeAlbedo(vec2 uv) {
    return texture(gMaterial, uv).rgb;
}

bool intersectSphere(vec3 ro, vec3 rd, float radius, out float t0, out float t1) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float discriminant = b * b - c;

    if (discriminant < 0.0) {
        return false;
    }

    float s = sqrt(discriminant);
    t0 = -b - s;
    t1 = -b + s;
    return true;
}

vec3 computeSunTint(vec3 position, vec3 lightDir) {
    float sunHeight = clamp(dot(normalize(position), lightDir), -1.0, 1.0);

    float dayFactor = smoothstep(-0.08, 0.12, sunHeight);
    float horizonBand = smoothstep(0.02, 0.18, 1.0 - abs(sunHeight)) * smoothstep(-0.05, 0.18, sunHeight);

    vec3 nightColor = vec3(0.04, 0.07, 0.12);
    vec3 dayColor = vec3(0.94, 0.95, 0.93);
    vec3 goldenColor = vec3(1.04, 0.72, 0.46);
    vec3 twilightColor = vec3(0.48, 0.36, 0.60);

    vec3 warmBlend = mix(dayColor, goldenColor, horizonBand);
    vec3 base = mix(nightColor, warmBlend, dayFactor);
    return mix(base, twilightColor, horizonBand * 0.55);
}

float computeShadow(vec3 pos, vec3 normal) {
    vec3 lightDir = normalize(sunDir);
    float ndl = dot(normal, lightDir);
    float horizon = smoothstep(-0.2, 0.05, ndl);
    return clamp(ndl * 0.5 + 0.5, 0.0, 1.0) * horizon;
}

vec3 shadeWater(
    vec3 pos,
    vec3 normal,
    vec3 floorColor,
    float depth,
    float viewWaterThickness,
    vec3 sunColor,
    float shadow,
    vec3 ambientLight
) {
    vec3 lightDir = normalize(sunDir);
    vec3 viewDir = normalize(camPos - pos);

    float ndl = max(dot(normal, lightDir), 0.0);
    float viewFacing = max(dot(normal, viewDir), 0.0);
    float entryCos = max(dot(normal, -viewDir), 0.05);

    // Beer-Lambert attenuation scaled by incidence angle so grazing views
    // travel through more water and darken appropriately.
    float pathLength = depth / entryCos + viewWaterThickness;
    float absorption = exp(-waterAbsorption * pathLength * 0.42);

    // Forward scattering brightens water that looks toward the sun.
    float forward = pow(max(dot(viewDir, lightDir), 0.0), 4.0);
    float scatterAmount = mix(0.12, 0.75, waterScattering);
    float sunFacing = ndl * 0.6 + forward;
    vec3 inScattering = waterColor * (1.0 - absorption) * (0.25 + scatterAmount * sunFacing) * (sunColor * shadow + ambientLight);

    float bedDarken = smoothstep(0.0, 80.0, depth);
    vec3 transmitted = floorColor * absorption * mix(1.0, 0.25, bedDarken);
    vec3 reflected = mix(waterColor, sunColor, 0.25) * (0.35 + 0.65 * ndl * shadow);

    float fresnel = 0.02 + pow(1.0 - viewFacing, 5.0);

    vec3 ambientReflection = ambientLight * (0.25 + 0.35 * (1.0 - absorption));
    vec3 color = mix(transmitted + inScattering, reflected + ambientReflection, fresnel);

    float spec = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 48.0) * shadow;
    color += spec * mix(0.08, 0.35, scatterAmount) * sunColor;

    return color;
}

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    float heightValue = decodeHeight(uv);
    vec4 normalFlags = decodeNormalFlags(uv);
    vec3 normal = normalize(normalFlags.xyz);
    float waterFlag = normalFlags.w;
    vec3 albedo = decodeAlbedo(uv);

    bool hit = waterFlag > -0.5;

    vec3 lightDir = normalize(sunDir);
    vec3 viewDir = normalize(camPos - pos);

    float rawNdl = dot(normal, lightDir);
    float ndl = max(rawNdl, 0.0);
    float wrapNdl = clamp((rawNdl + 0.65) / 1.65, 0.0, 1.0);
    float horizonBlend = smoothstep(-0.35, 0.45, rawNdl);
    float softHalo = smoothstep(-0.68, -0.08, rawNdl) * (1.0 - horizonBlend);
    float sunHeight = dot(normalize(pos), lightDir);

    float sunIntensity = max(sunPower, 0.0);
    vec3 sunColor = computeSunTint(pos, lightDir) * sunIntensity;
    float sunVisibility = smoothstep(-0.08, 0.05, sunHeight);
    vec3 effectiveSunColor = sunColor * sunVisibility;
    float twilight = smoothstep(-0.45, 0.05, sunHeight);
    vec3 ambientLight = mix(vec3(0.02, 0.04, 0.06), vec3(0.16, 0.22, 0.32), twilight);
    float ambientStrength = mix(0.02, 0.14, twilight);

    softHalo *= sunVisibility;

    vec3 directLight = effectiveSunColor * (wrapNdl * horizonBlend + softHalo * 0.5);
    vec3 ambient = ambientLight * (ambientStrength + softHalo * 0.25);

    float shadow = hit ? computeShadow(pos, normal) : 0.0;

    vec3 toPos = pos - camPos;
    float distToPos = length(toPos);
    vec3 viewDir2 = distToPos > 0.0 ? toPos / distToPos : vec3(0.0, 0.0, 1.0);

    float t0, t1;
    float waterRadius = planetRadius + seaLevel;
    bool throughWater = intersectSphere(camPos, viewDir2, waterRadius, t0, t1);
    float waterPath = 0.0;
    if (throughWater && t1 > 0.0) {
        if (t0 < 0.0) t0 = 0.0;
        float exitT = min(t1, distToPos);
        if (exitT > t0) {
            waterPath = exitT - t0;
        }
    }

    float waterDepth = (waterFlag > 0.5) ? max(seaLevel - heightValue, 0.0) : 0.0;
    vec3 waterShaded = shadeWater(pos, normal, albedo, waterDepth, waterPath, effectiveSunColor, shadow, ambient);

    vec3 color = albedo * (ambient + directLight * shadow);
    if (waterFlag > 0.5) {
        color = waterShaded;
    } else {
        float spec = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 24.0) * shadow;
        color += spec * effectiveSunColor * 0.08;

        if (waterPath > 0.0) {
            float waterAtten = exp(-waterAbsorption * waterPath * 0.65);
            float murk = smoothstep(0.0, 120.0, waterPath);
            vec3 fog = mix(waterColor * 0.35, waterColor * 0.6, murk) * (effectiveSunColor * 0.25 + ambient * 0.5);
            color = mix(fog, color, waterAtten);
        }
    }

    FragColor = vec4(color, shadow);
}
