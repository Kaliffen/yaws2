#version 410 core

out vec4 FragColor;

in vec2 TexCoord;

uniform sampler2D gPositionHeight;
uniform sampler2D gNormalFlags;
uniform sampler2D gMaterial;
uniform sampler2D lightingTex;
uniform sampler2D atmosphereTex;
uniform sampler2D cloudTex;

uniform float heightScale;
uniform float maxRayDistance;

uniform bool showLayer[9];

// Toggle indices
// 0: sdf (depth visualization)
// 1: height map
// 2: lighting only
// 3: shadow/occlusion debug
// 4: water contribution
// 5: atmosphere scatter
// 6: clouds
// 7: albedo
// 8: final composite

vec3 decodePosition(vec2 uv) {
    return texture(gPositionHeight, uv).xyz;
}

float decodeHeight(vec2 uv) {
    return texture(gPositionHeight, uv).w;
}

vec4 decodeNormalFlags(vec2 uv) {
    return texture(gNormalFlags, uv);
}

vec4 decodeMaterial(vec2 uv) {
    return texture(gMaterial, uv);
}

void main() {
    vec2 uv = TexCoord;

    vec3 pos = decodePosition(uv);
    float heightValue = decodeHeight(uv);
    vec4 normalFlags = decodeNormalFlags(uv);
    float waterFlag = normalFlags.w;
    vec4 material = decodeMaterial(uv);
    vec3 albedo = material.rgb;

    bool hit = waterFlag > -0.5;

    vec4 lightingSample = texture(lightingTex, uv);
    vec4 atmosphereSample = texture(atmosphereTex, uv);
    vec4 cloudSample = texture(cloudTex, uv);

    float sdfDepth = clamp(length(pos) / maxRayDistance, 0.0, 1.0);
    float heightView = clamp((heightValue + heightScale) / (heightScale * 2.0), 0.0, 1.0);

    float shadow = lightingSample.a;
    float cloudTransmittance = cloudSample.a;
    float atmosphereTransmittance = atmosphereSample.a;

    vec3 lighting = lightingSample.rgb;
    vec3 atmosphere = atmosphereSample.rgb;
    vec3 clouds = cloudSample.rgb;

    vec3 composite = (lighting * atmosphereTransmittance) * cloudTransmittance;
    composite += atmosphere * cloudTransmittance;
    composite += clouds;

    if (showLayer[0]) {
        FragColor = vec4(vec3(sdfDepth), 1.0);
        return;
    }
    if (showLayer[1]) {
        FragColor = vec4(vec3(heightView), 1.0);
        return;
    }
    if (showLayer[2]) {
        FragColor = vec4(lighting, 1.0);
        return;
    }
    if (showLayer[3]) {
        FragColor = vec4(vec3(shadow), 1.0);
        return;
    }
    if (showLayer[4]) {
        vec3 waterOnly = (waterFlag > 0.5) ? lighting : vec3(0.0);
        FragColor = vec4(waterOnly, 1.0);
        return;
    }
    if (showLayer[5]) {
        FragColor = vec4(atmosphere, 1.0);
        return;
    }
    if (showLayer[6]) {
        FragColor = vec4(clouds, 1.0);
        return;
    }
    if (showLayer[7]) {
        FragColor = vec4(albedo, 1.0);
        return;
    }

    FragColor = vec4(composite, 1.0);
}
