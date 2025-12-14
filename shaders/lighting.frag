#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;
uniform sampler2D gViewData;

uniform vec3 camPos;
uniform vec3 sunDir;
uniform float sunPower;
uniform vec3 moonDir;
uniform float moonPower;
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

vec4 decodeViewData(vec2 uv) {
    return texture(gViewData, uv);
}

vec3 computeSunTint(vec3 position, vec3 lightDir) {
    float sunHeight = clamp(dot(normalize(position), lightDir), -1.0, 1.0);

    float dayFactor = smoothstep(-0.02, 0.08, sunHeight);
    float goldenBand = 1.0 - smoothstep(0.01, 0.1, abs(sunHeight));

    vec3 nightColor = vec3(0.04, 0.07, 0.12);
    vec3 dayColor = vec3(0.94, 0.95, 0.93);
    vec3 goldenColor = vec3(1.04, 0.72, 0.46);
    vec3 twilightColor = vec3(0.48, 0.36, 0.60);

    vec3 warmBlend = mix(dayColor, goldenColor, goldenBand * 1.35);
    vec3 base = mix(nightColor, warmBlend, dayFactor);
    return mix(base, twilightColor, goldenBand * 0.15);
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
    vec3 moonColor,
    vec3 moonLightDir,
    float shadow,
    vec3 ambientLight
) {
    vec3 lightDir = normalize(sunDir);
    vec3 moonDirNorm = normalize(moonLightDir);
    vec3 viewDir = normalize(camPos - pos);

    float ndl = max(dot(normal, lightDir), 0.0);
    float moonNdl = max(dot(normal, moonDirNorm), 0.0);
    float viewFacing = max(dot(normal, viewDir), 0.0);
    float entryCos = max(dot(normal, -viewDir), 0.05);

    // Beer-Lambert attenuation scaled by incidence angle so grazing views
    // travel through more water and darken appropriately.
    float pathLength = depth / entryCos + viewWaterThickness;
    float absorption = exp(-waterAbsorption * pathLength * 0.42);

    // Forward scattering brightens water that looks toward the sun.
    float forward = pow(max(dot(viewDir, lightDir), 0.0), 4.0);
    float forwardMoon = pow(max(dot(viewDir, moonDirNorm), 0.0), 4.0);
    float scatterAmount = mix(0.12, 0.75, waterScattering);
    float sunFacing = ndl * 0.6 + forward;
    float moonFacing = moonNdl * 0.45 + forwardMoon * 0.65;
    vec3 inScattering = waterColor * (1.0 - absorption) * (0.25 + scatterAmount * sunFacing) * (sunColor * shadow + ambientLight);
    inScattering += waterColor * (1.0 - absorption) * (0.18 + scatterAmount * moonFacing * 0.7) * (moonColor * shadow + ambientLight * 0.5);

    float bedDarken = smoothstep(0.0, 80.0, depth);
    vec3 transmitted = floorColor * absorption * mix(1.0, 0.25, bedDarken);
    vec3 reflected = mix(waterColor, sunColor + moonColor, 0.25) * (0.35 + 0.65 * (ndl * shadow + moonNdl * shadow * 0.6));

    float fresnel = 0.02 + pow(1.0 - viewFacing, 5.0);

    vec3 ambientReflection = (ambientLight + moonColor * 0.08) * (0.25 + 0.35 * (1.0 - absorption));
    vec3 color = mix(transmitted + inScattering, reflected + ambientReflection, fresnel);

    float spec = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 48.0) * shadow;
    float moonSpec = pow(max(dot(reflect(-moonDirNorm, normal), viewDir), 0.0), 32.0) * shadow;
    color += spec * mix(0.08, 0.35, scatterAmount) * sunColor;
    color += moonSpec * 0.05 * moonColor;

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
    vec4 viewData = decodeViewData(uv);

    bool hit = waterFlag > -0.5;

    vec3 lightDir = normalize(sunDir);
    vec3 moonLightDir = normalize(moonDir);
    vec3 viewDir = normalize(camPos - pos);

    float rawNdl = dot(normal, lightDir);
    float ndl = max(rawNdl, 0.0);
    float wrapNdl = clamp((rawNdl + 0.65) / 1.65, 0.0, 1.0);
    float horizonBlend = smoothstep(-0.18, 0.25, rawNdl);
    float softHalo = smoothstep(-0.4, -0.05, rawNdl) * (1.0 - horizonBlend);
    float sunHeight = dot(normalize(pos), lightDir);

    float moonRawNdl = dot(normal, moonLightDir);
    float moonNdl = max(moonRawNdl, 0.0);
    float moonWrap = clamp((moonRawNdl + 0.6) / 1.6, 0.0, 1.0);
    float moonHorizon = smoothstep(-0.24, 0.08, moonRawNdl);
    float moonHeight = dot(normalize(pos), moonLightDir);

    float sunIntensity = max(sunPower, 0.0);
    float sunPresence = clamp(sunIntensity, 0.0, 1.0);
    vec3 sunColor = computeSunTint(pos, lightDir) * sunIntensity;
    float sunVisibility = smoothstep(-0.02, 0.04, sunHeight) * sunPresence;
    vec3 effectiveSunColor = sunColor * sunVisibility;
    float twilight = smoothstep(-0.18, 0.04, sunHeight) * sunPresence;
    vec3 ambientLight = mix(vec3(0.02, 0.04, 0.06), vec3(0.16, 0.22, 0.32), twilight);
    float ambientStrength = mix(0.02, 0.14, twilight);

    float moonIntensity = max(moonPower, 0.0);
    float moonVisibility = smoothstep(-0.26, 0.02, moonHeight);
    vec3 moonColor = vec3(0.72, 0.78, 0.90) * moonIntensity * moonVisibility;
    ambientLight += moonColor * 0.12;

    softHalo *= sunVisibility;

    float shadow = hit ? computeShadow(pos, normal) : 0.0;

    vec3 sunDirect = effectiveSunColor * (wrapNdl * horizonBlend + softHalo * 0.5);
    vec3 moonDirect = moonColor * (moonWrap * moonHorizon);
    vec3 directLight = sunDirect + moonDirect;
    vec3 ambient = ambientLight * (ambientStrength + softHalo * 0.25);

    float distToPos = viewData.x;
    vec3 toPos = pos - camPos;
    vec3 viewDir2 = distToPos > 0.0 ? toPos / distToPos : vec3(0.0, 0.0, 1.0);
    float waterPath = max(viewData.w, 0.0);

    float waterDepth = (waterFlag > 0.5) ? max(seaLevel - heightValue, 0.0) : 0.0;
    vec3 waterShaded = shadeWater(pos, normal, albedo, waterDepth, waterPath, effectiveSunColor, moonColor, moonLightDir, shadow, ambient);

    vec3 color = albedo * (ambient + directLight * shadow);
    if (waterFlag > 0.5) {
        color = waterShaded;
    } else {
        float spec = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 24.0) * shadow;
        float moonSpec = pow(max(dot(reflect(-moonLightDir, normal), viewDir), 0.0), 20.0) * shadow;
        color += spec * effectiveSunColor * 0.08;
        color += moonSpec * moonColor * 0.05;

        if (waterPath > 0.0) {
            float waterAtten = exp(-waterAbsorption * waterPath * 0.65);
            float murk = smoothstep(0.0, 120.0, waterPath);
            vec3 fog = mix(waterColor * 0.35, waterColor * 0.6, murk) * (effectiveSunColor * 0.25 + moonColor * 0.15 + ambient * 0.5);
            color = mix(fog, color, waterAtten);
        }
    }

    FragColor = vec4(color, shadow);
}
