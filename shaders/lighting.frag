#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;

uniform vec3 camPos;
uniform vec3 sunDir;
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

float computeShadow(vec3 pos, vec3 normal) {
    vec3 lightDir = normalize(sunDir);
    float ndl = dot(normal, lightDir);
    float horizon = smoothstep(-0.2, 0.05, ndl);
    return clamp(ndl * 0.5 + 0.5, 0.0, 1.0) * horizon;
}

vec3 shadeWater(vec3 pos, vec3 normal, vec3 floorColor, float depth) {
    vec3 lightDir = normalize(sunDir);
    vec3 viewDir = normalize(camPos - pos);

    float ndl = max(dot(normal, lightDir), 0.0);
    float viewFacing = max(dot(normal, viewDir), 0.0);
    float entryCos = max(dot(normal, -viewDir), 0.05);

    // Beer-Lambert attenuation scaled by incidence angle so grazing views
    // travel through more water and darken appropriately.
    float pathLength = depth / entryCos;
    float absorption = exp(-waterAbsorption * pathLength * 0.35);

    // Forward scattering brightens water that looks toward the sun.
    float forward = pow(max(dot(viewDir, lightDir), 0.0), 4.0);
    float scatterAmount = mix(0.12, 0.75, waterScattering);
    vec3 inScattering = waterColor * (1.0 - absorption) * (0.35 + scatterAmount * (ndl * 0.6 + forward));

    vec3 transmitted = floorColor * absorption;
    vec3 reflected = waterColor * (0.35 + 0.65 * ndl);

    float fresnel = 0.02 + pow(1.0 - viewFacing, 5.0);

    vec3 color = mix(transmitted + inScattering, reflected, fresnel);

    float spec = pow(max(dot(reflect(-lightDir, normal), viewDir), 0.0), 48.0);
    color += spec * mix(0.08, 0.35, scatterAmount);

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
    float ndl = max(dot(normal, lightDir), 0.0);
    float horizonBlend = smoothstep(0.0, 0.22, ndl);
    float ambient = 0.01;
    float lighting = hit ? clamp(ambient + ndl * horizonBlend, 0.0, 1.0) : 0.0;

    float shadow = hit ? computeShadow(pos, normal) : 0.0;

    float waterDepth = (waterFlag > 0.5) ? max(seaLevel - heightValue, 0.0) : 0.0;
    vec3 waterShaded = shadeWater(pos, normal, albedo, waterDepth);

    vec3 color = albedo * lighting;
    if (waterFlag > 0.5) {
        color = waterShaded;
    }
    color *= shadow;

    FragColor = vec4(color, shadow);
}
