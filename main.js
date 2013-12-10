(function () {

    var gl,
        canvas,
        animationStartTime,
        ongoingImageLoads = [],
        pressedKeys = [],
        xOffs = yOffs = drag = 0,
        requestId;

    var Rot = {
        x: 0,
        y: 0,
        x: 0
    };

    var Trans = {
        x: 0,
        y: 0,
        z: 0
    };

    // Earth properties.
    var Earth = {
        lat: 30,
        lon: 30,
        radius: 5,
        rotation: 0,
        speed: 750,
        texture: {
            url: 'media/earth.jpg',
            obj: null
        }
    };

    // Satellite properties.
    var Satellite = {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        radius: {
            pos: 5.5,
            min: 5.5
        },
        orbit: {
            time: 1000,
            min: 2000,
            max: 50
        },
        angle: 0,
        speed: 1,
        scale: [0.15, 0.15, 0.15],
        texture: {
            front: {
                url: 'media/satellite_front.jpg',
                obj: null
            },
            back: {
                url: 'media/satellite_back.jpg',
                obj: null
            }
        }
    };

    var Light = {
        pos: [15, 20, 0],
        ambient: [0.2, 0.2, 0.2],
        diffuse: [0.6, 0.6, 0.6],
        specular: [0.9, 0.9, 0.9]
    };

    /** Setup the canvas, context & start the application. */
    var main = function () {
        canvas = document.getElementById('DOMCanvas');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        canvas = WebGLDebugUtils.makeLostContextSimulatingCanvas(canvas);
        canvas.addEventListener('webglcontextlost', handleContextLost, false);
        canvas.addEventListener('webglcontextrestored', handleContextRestored, false);
        canvas.addEventListener('mousemove', onMouseMove, false);
        canvas.addEventListener('mousedown', onMouseDown, false);
        canvas.addEventListener('mouseup', onMouseUp, false);
        canvas.addEventListener('mousewheel', wheelHandler, false);
        canvas.addEventListener('DOMMouseScroll', wheelHandler, false);
        document.addEventListener('keyup', onKeyUp, false);
        document.addEventListener('keydown', onKeyDown, false);
        window.addEventListener('resize', function () {
            canvas.width = gl.viewportWidth = window.innerWidth;
            canvas.height = gl.viewportHeight = window.innerHeight;
            gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
            mat4.perspective(60, gl.viewportWidth / gl.viewportHeight, 1, 100.0, PROJ_MATRIX);
        }, false);

        gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        gl.viewportWidth = canvas.width;
        gl.viewportHeight = canvas.height;

        if (!gl) return console.log('Unable to create context');
        init();
        draw();
    };

    /** Initialise the shaders, buffers, lights & textures. */
    var init = function () {
        setupShaders();
        setupBuffers();
        setupLights();
        setupTextures();

        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.enable(gl.DEPTH_TEST);
        gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        mat4.perspective(60, gl.viewportWidth / gl.viewportHeight, 1, 100.0, PROJ_MATRIX);
        mat4.identity(MV_MATRIX);
        mat4.lookAt([0, 0, 15], [0, 0, 0], [0, 1, 0], MV_MATRIX);
    };

    var MV_MATRIX = mat4.create(),
        PROJ_MATRIX = mat4.create(),
        MV_MATRIX_STACK = [];

    /**
     * Matrix Uploaders.
     */
    
    /** Upload normals matrix to the shaders. */
    var uploadNormalMatrixToShader = function () {
        var normalMatrix = mat3.create();
        mat4.toInverseMat3(MV_MATRIX, normalMatrix);
        mat3.transpose(normalMatrix);
        gl.uniformMatrix3fv(UNIFORM_NORMAL_MATRIX_LOC, false, normalMatrix);
    };

    /** Upload modelview matrix to the shaders. */
    var uploadMVMatrixToShader = function () {
        gl.uniformMatrix4fv(UNIFORM_MV_MATRIX_LOC, false, MV_MATRIX);
    };

    /** Upload projection matrix to the shaders. */
    var uploadProjMatrixToShader = function () {
        gl.uniformMatrix4fv(UNIFORM_PROJ_MATRIX_LOC, false, PROJ_MATRIX);
    };

    /**
     * Model View Matrix Arrays.
     */

    /** Push new matrix to the modelview stack. */
    var pushMVMatrix = function () {
        var copy = mat4.create(MV_MATRIX);
        MV_MATRIX_STACK.push(copy);
    };

    /** Pop a matrix from the modelview stack. */
    var popMVMatrix = function () {
        if (MV_MATRIX_STACK.length === 0)
            return console.log('MV_MATRIX_STACK was empty.');
        MV_MATRIX = MV_MATRIX_STACK.pop();
    };

    /**
     * Degrees to Radians
     */
    var degToRad = function (degrees) {
        return degrees * Math.PI / 180;
    };

    /**
     * Shaders.
     */

    /** Setup the shaders (vertex and fragment). */
    var setupShaders = function () {
        var vertex = loadShader('shader-vs'),
            fragment = loadShader('shader-fs'),
            program = gl.createProgram();

        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost())
            return console.log('Failed to link shaders', gl.getProgramInfoLog(program));
        gl.useProgram(program);

        getShaderLocations(program);
    };

    /** Load a shader into the application. */
    var loadShader = function (id) {
        var shader = null;
        var script = document.getElementById(id);
        var source = '';
        if (!script) return null;
        var currentChild = script.firstChild;

        while (currentChild) {
            if (currentChild.nodeType === 3) source += currentChild.textContent;
            currentChild = currentChild.nextSibling;
        }

        switch (script.type) {
            case 'x-shader/x-fragment': shader = gl.createShader(gl.FRAGMENT_SHADER); break;
            case 'x-shader/x-vertex': shader = gl.createShader(gl.VERTEX_SHADER); break;
            default: return null;
        }

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost())
            return console.log('Shader failed to load', gl.getShaderInfoLog(shader));
        return shader;
    };

    var VERTEX_POSITION_ATTRIB_LOC,
        VERTEX_TEXTURE_ATTRIB_LOC,
        VERTEX_NORMAL_ATTRIB_LOC,
        UNIFORM_MV_MATRIX_LOC,
        UNIFORM_PROJ_MATRIX_LOC,
        UNIFORM_SAMPLER_LOC,
        UNIFORM_NORMAL_MATRIX_LOC,
        UNIFORM_LIGHT_POSITION_LOC,
        UNIFORM_AMBIENT_LIGHT_COLOR_LOC,
        UNIFORM_DIFFUSE_LIGHT_COLOR_LOC,
        UNIFORM_SPECULAR_LIGHT_COLOR_LOC;

    /** Retreive attribute and uniform locations in the shaders. */
    var getShaderLocations = function (program) {
        VERTEX_POSITION_ATTRIB_LOC = gl.getAttribLocation(program, 'aVertexPosition');
        VERTEX_TEXTURE_ATTRIB_LOC = gl.getAttribLocation(program, 'aTextureCoordinates');
        VERTEX_NORMAL_ATTRIB_LOC = gl.getAttribLocation(program, 'aVertexNormal');

        gl.enableVertexAttribArray(VERTEX_POSITION_ATTRIB_LOC);
        gl.enableVertexAttribArray(VERTEX_TEXTURE_ATTRIB_LOC);
        gl.enableVertexAttribArray(VERTEX_NORMAL_ATTRIB_LOC);

        UNIFORM_MV_MATRIX_LOC = gl.getUniformLocation(program, 'uMVMatrix');
        UNIFORM_PROJ_MATRIX_LOC = gl.getUniformLocation(program, 'uPMatrix');
        UNIFORM_NORMAL_MATRIX_LOC = gl.getUniformLocation(program, "uNMatrix");
        UNIFORM_SAMPLER_LOC = gl.getUniformLocation(program, 'uSampler');

        UNIFORM_LIGHT_POSITION_LOC = gl.getUniformLocation(program, "uLightPosition");
        UNIFORM_AMBIENT_LIGHT_COLOR_LOC = gl.getUniformLocation(program, "uAmbientLightColor");  
        UNIFORM_DIFFUSE_LIGHT_COLOR_LOC = gl.getUniformLocation(program, "uDiffuseLightColor");
        UNIFORM_SPECULAR_LIGHT_COLOR_LOC = gl.getUniformLocation(program, "uSpecularLightColor");
    };

    /**
     * Lights.
     */

    /** Setup the lights for the scene. */
    var setupLights = function () {
        gl.uniform3fv(UNIFORM_LIGHT_POSITION_LOC, Light.pos);
        gl.uniform3fv(UNIFORM_AMBIENT_LIGHT_COLOR_LOC, Light.ambient);
        gl.uniform3fv(UNIFORM_DIFFUSE_LIGHT_COLOR_LOC, Light.diffuse);
        gl.uniform3fv(UNIFORM_SPECULAR_LIGHT_COLOR_LOC, Light.specular);
    };

    /**
     * Buffers.
     */

    /** Setup the buffers. */
    var setupBuffers = function () {
        setupSphereBuffers();
        setupCubeBuffers();
    };

    var SPHERE_VERTEX_POSITION_BUFFER,
        SPHERE_VERTEX_INDEX_BUFFER,
        SPHERE_VERTEX_TEXTURE_COORD_BUFFER,
        SPHERE_VERTEX_NORMAL_BUFFER;

    /** Setup the buffers for the sphere (Earth). */
    var setupSphereBuffers = function () {
        var vertexPosition = [],
            normalData = [],
            textureCoord = [],
            vertexIndex = [];
        // Setup position and texture buffer
        for (var latNum = 0; latNum <= Earth.lat; latNum++) {
            var theta = latNum * Math.PI / Earth.lat,
                sinTheta = Math.sin(theta),
                cosTheta = Math.cos(theta);
            for (var lonNum = 0; lonNum <= Earth.lon; lonNum++) {
                var phi = lonNum * 2 * Math.PI / Earth.lon,
                    sinPhi = Math.sin(phi),
                    cosPhi = Math.cos(phi),
                    x = cosPhi * sinTheta,
                    y = cosTheta,
                    z = sinPhi * sinTheta,
                    u = 1 - (lonNum / Earth.lon),
                    v = 1 - (latNum / Earth.lat);
                normalData.push(x);
                normalData.push(y);
                normalData.push(z);
                textureCoord.push(u);
                textureCoord.push(v);
                vertexPosition.push(Earth.radius * x);
                vertexPosition.push(Earth.radius * y);
                vertexPosition.push(Earth.radius * z);
            }
        }
        for (var latNum = 0; latNum < Earth.lat; latNum++) {
            for (var lonNum = 0; lonNum < Earth.lon; lonNum++) {
                var first = (latNum * (Earth.lon + 1)) + lonNum,
                    second = first + Earth.lon + 1;
                vertexIndex.push(first);
                vertexIndex.push(second);
                vertexIndex.push(first + 1);
                vertexIndex.push(second);
                vertexIndex.push(second + 1);
                vertexIndex.push(first + 1);
            }
        }
        // Create the normals buffer (array buffer)
        SPHERE_VERTEX_NORMAL_BUFFER = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, SPHERE_VERTEX_NORMAL_BUFFER);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normalData), gl.STATIC_DRAW);
        SPHERE_VERTEX_NORMAL_BUFFER.itemSize = 3;
        SPHERE_VERTEX_NORMAL_BUFFER.numOfItems = normalData.length / 3;
        // Create the texture buffer (array buffer)
        SPHERE_VERTEX_TEXTURE_COORD_BUFFER = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, SPHERE_VERTEX_TEXTURE_COORD_BUFFER);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoord), gl.STATIC_DRAW);
        SPHERE_VERTEX_TEXTURE_COORD_BUFFER.itemSize = 2;
        SPHERE_VERTEX_TEXTURE_COORD_BUFFER.numOfItems = textureCoord.length / 2;
        // Create the position buffer (array buffer)
        SPHERE_VERTEX_POSITION_BUFFER = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, SPHERE_VERTEX_POSITION_BUFFER);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexPosition), gl.STATIC_DRAW);
        SPHERE_VERTEX_POSITION_BUFFER.itemSize = 3;
        SPHERE_VERTEX_POSITION_BUFFER.numOfItems = vertexPosition.length / 3;
        // Create the index buffer (element array buffer)
        SPHERE_VERTEX_INDEX_BUFFER = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, SPHERE_VERTEX_INDEX_BUFFER);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(vertexIndex), gl.STATIC_DRAW);
        SPHERE_VERTEX_INDEX_BUFFER.itemSize = 1;
        SPHERE_VERTEX_INDEX_BUFFER.numOfItems = vertexIndex.length;
    };

    var CUBE_VERTEX_POSITION_BUFFER,
        CUBE_VERTEX_INDEX_BUFFER,
        CUBE_TEXTURE_COORDS_BUFFER,
        CUBE_VERTEX_NORMALS_BUFFER;

    /** Setup the buffers for the cube (Satellite). */
    var setupCubeBuffers = function () {
        vertexPosition = [
             1.0,  1.0,  1.0, // Front Face
            -1.0,  1.0,  1.0,
            -1.0, -1.0,  1.0,
             1.0, -1.0,  1.0,
             1.0,  1.0, -1.0, // Back Face
            -1.0,  1.0, -1.0,
            -1.0, -1.0, -1.0,
             1.0, -1.0, -1.0,
            -1.0,  1.0,  1.0, // Left Face
            -1.0,  1.0, -1.0,
            -1.0, -1.0, -1.0,
            -1.0, -1.0,  1.0,
             1.0,  1.0,  1.0, // Right Face
             1.0, -1.0,  1.0,
             1.0, -1.0, -1.0,
             1.0,  1.0, -1.0,
             1.0,  1.0,  1.0, // Top Face
             1.0,  1.0, -1.0,
            -1.0,  1.0, -1.0,
            -1.0,  1.0,  1.0,
             1.0, -1.0,  1.0, // Bottom Face
             1.0, -1.0, -1.0,
            -1.0, -1.0, -1.0,
            -1.0, -1.0,  1.0],
        vertexIndex = [
             0, 1, // Front Face
             2, 0,
             2, 3,
             4, 6, // Back Face
             5, 4,
             7, 6,
             8, 9, // Left Face
             10, 8,
             10, 11,
             12, 13, // Right Face
             14, 12,
             14, 15,
             16, 17, // Top Face
             18, 16,
             18, 19,
             20, 22, // Bottom Face
             21, 20,
             23, 22],
        textureCoord = [
             0.0, 0.0, //Front Face
             1.0, 0.0,
             1.0, 1.0,
             0.0, 1.0,
             0.0, 1.0, // Back Face
             1.0, 1.0,
             1.0, 0.0,
             0.0, 0.0,
             0.0, 1.0, // Left Face
             1.0, 1.0,
             1.0, 0.0,
             0.0, 0.0,
             0.0, 1.0, // Right Face
             1.0, 1.0,
             1.0, 0.0,
             0.0, 0.0,
             0.0, 1.0, // Top Face
             1.0, 1.0,
             1.0, 0.0,
             0.0, 0.0,
             0.0, 1.0, // Bottom Face
             1.0, 1.0,
             1.0, 0.0,
             0.0, 0.0],
        normalData = [
             0.0,  0.0,  1.0, // Front Face
             0.0,  0.0,  1.0,
             0.0,  0.0,  1.0,
             0.0,  0.0,  1.0,
             0.0,  0.0, -1.0, // Back Face
             0.0,  0.0, -1.0,
             0.0,  0.0, -1.0,
             0.0,  0.0, -1.0,      
            -1.0,  0.0,  0.0, // Left Face
            -1.0,  0.0,  0.0,
            -1.0,  0.0,  0.0,
            -1.0,  0.0,  0.0,      
             1.0,  0.0,  0.0, // Right Face
             1.0,  0.0,  0.0,
             1.0,  0.0,  0.0,
             1.0,  0.0,  0.0,      
             0.0,  1.0,  0.0, // Top Face
             0.0,  1.0,  0.0,
             0.0,  1.0,  0.0,
             0.0,  1.0,  0.0,      
             0.0, -1.0,  0.0, // Bottom Face
             0.0, -1.0,  0.0,
             0.0, -1.0,  0.0,
             0.0, -1.0,  0.0];
        // Specify normals to be able to do lighting calculations
        CUBE_VERTEX_NORMALS_BUFFER = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, CUBE_VERTEX_NORMALS_BUFFER);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normalData), gl.STATIC_DRAW);
        CUBE_VERTEX_NORMALS_BUFFER.itemSize = 3;
        CUBE_VERTEX_NORMALS_BUFFER.numOfItems = 24;
        // Setup buffer with position coordinates
        CUBE_VERTEX_POSITION_BUFFER = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, CUBE_VERTEX_POSITION_BUFFER);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexPosition), gl.STATIC_DRAW);
        CUBE_VERTEX_POSITION_BUFFER.itemSize = 3;
        CUBE_VERTEX_POSITION_BUFFER.numOfItems = 24;
        // Setup buffer with index
        CUBE_VERTEX_INDEX_BUFFER = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, CUBE_VERTEX_INDEX_BUFFER);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(vertexIndex), gl.STATIC_DRAW);
        CUBE_VERTEX_INDEX_BUFFER.itemSize = 1;
        CUBE_VERTEX_INDEX_BUFFER.numOfItems = 36;
        // Setup buffer with texture coordinates
        CUBE_TEXTURE_COORDS_BUFFER = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, CUBE_TEXTURE_COORDS_BUFFER);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoord),gl.STATIC_DRAW);
        CUBE_TEXTURE_COORDS_BUFFER.itemSize = 2;
        CUBE_TEXTURE_COORDS_BUFFER.numOfItems = 24;
    };

    /**
     * Textures.
     */

    /** Setup the textures. */
    var setupTextures = function () {
        Earth.texture.obj = gl.createTexture();
        loadImage(Earth.texture.url, Earth.texture.obj, gl.TEXTURE_2D, gl.LINEAR, gl.LINEAR, gl.MIRRORED_REPEAT, gl.MIRRORED_REPEAT);

        Satellite.texture.front.obj = gl.createTexture();
        loadImage(Satellite.texture.front.url, Satellite.texture.front.obj, gl.TEXTURE_2D, gl.LINEAR, gl.LINEAR, gl.MIRRORED_REPEAT, gl.MIRRORED_REPEAT);

        Satellite.texture.back.obj = gl.createTexture();
        loadImage(Satellite.texture.back.url, Satellite.texture.back.obj, gl.TEXTURE_2D, gl.LINEAR, gl.LINEAR, gl.MIRRORED_REPEAT, gl.MIRRORED_REPEAT);
    };

    /** Load an image to be used as a texture. */
    var loadImage = function (url, texture, target, minFilter, magFilter, wrapS, wrapT) {
        var image = new Image();
        image.addEventListener('load', function loaded(e) {
            ongoingImageLoads.splice(ongoingImageLoads.indexOf(image), 1);
            buildTexture(target, texture, image, minFilter, magFilter, wrapS, wrapT);
            e.preventDefault();
        }, false);
        ongoingImageLoads.push(image);
        image.src = url;
    };

    /** Build a texture, once the image has loaded. */
    var buildTexture = function (target, texture, image, minFilter, magFilter, wrapS, wrapT) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.bindTexture(target, texture);

        gl.texImage2D(target, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(target);

        gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, magFilter);
        gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, minFilter);
        gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrapS);
        gl.texParameteri(target, gl.TEXTURE_WRAP_T, wrapT);

        gl.bindTexture(target, null);
    };

    /**
     * Drawing.
     */
    
    var lastTime = Date.now();
    
    /** Render the image. */
    var draw = function () {
        requestId = requestAnimationFrame(draw);
        var currentTime = Date.now();
        if (typeof animationStartTime === 'undefined') animationStartTime = currentTime;

        handleKeyPresses();

        mat4.rotateX(MV_MATRIX, degToRad(Rot.x), MV_MATRIX);
        mat4.rotateY(MV_MATRIX, degToRad(Rot.y), MV_MATRIX);
        mat4.translate(MV_MATRIX, [Trans.x, Trans.y, Trans.z], MV_MATRIX);

        Rot.y = Rot.x = Rot.z = Trans.x = Trans.y = Trans.z = 0;
        
        uploadMVMatrixToShader();
        uploadProjMatrixToShader();
        uploadNormalMatrixToShader();
        gl.uniform1i(UNIFORM_SAMPLER_LOC, 0);
        gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        pushMVMatrix();
        mat4.rotateY(MV_MATRIX, Earth.rotation, MV_MATRIX);
        uploadMVMatrixToShader();
        uploadNormalMatrixToShader();
        drawSphere(Earth.texture.obj);
        popMVMatrix();

        pushMVMatrix();
        mat4.translate(MV_MATRIX, [Satellite.x, Satellite.y, Satellite.z], MV_MATRIX);
        mat4.rotateY(MV_MATRIX, (Math.PI - Satellite.angle), MV_MATRIX);
        mat4.scale(MV_MATRIX, Satellite.scale, MV_MATRIX);
        uploadMVMatrixToShader();
        uploadNormalMatrixToShader();
        drawCube(Satellite.texture.front.obj, Satellite.texture.back.obj);
        popMVMatrix();

        // Rotation of the satellite.
        Satellite.angle += (currentTime - lastTime) / Satellite.orbit.time % (2 * Math.PI);
        Satellite.x = Math.cos(Satellite.angle) * Satellite.radius.pos;
        Satellite.z = Math.sin(Satellite.angle) * Satellite.radius.pos;

        lastTime = currentTime;

        // Rotation of the earth.
        Earth.rotation += Math.PI / Earth.speed;
        if (Earth.rotation > 2 * Math.PI) Earth.rotation = 0
    };

    /** Render the sphere (world). */
    var drawSphere = function (texture) {
        gl.bindBuffer(gl.ARRAY_BUFFER, SPHERE_VERTEX_POSITION_BUFFER);
        gl.vertexAttribPointer(VERTEX_POSITION_ATTRIB_LOC, SPHERE_VERTEX_POSITION_BUFFER.itemSize, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, SPHERE_VERTEX_NORMAL_BUFFER);
        gl.vertexAttribPointer(VERTEX_NORMAL_ATTRIB_LOC, SPHERE_VERTEX_NORMAL_BUFFER.itemSize, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, SPHERE_VERTEX_TEXTURE_COORD_BUFFER);
        gl.vertexAttribPointer(VERTEX_TEXTURE_ATTRIB_LOC, SPHERE_VERTEX_TEXTURE_COORD_BUFFER.itemSize, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, SPHERE_VERTEX_INDEX_BUFFER);
        gl.drawElements(gl.TRIANGLES, SPHERE_VERTEX_INDEX_BUFFER.numOfItems, gl.UNSIGNED_SHORT, 0);
    };

    /** Render the cube (satellite). */
    var drawCube = function () {
        gl.bindBuffer(gl.ARRAY_BUFFER, CUBE_VERTEX_POSITION_BUFFER);
        gl.vertexAttribPointer(VERTEX_POSITION_ATTRIB_LOC, CUBE_VERTEX_POSITION_BUFFER.itemSize, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, CUBE_VERTEX_NORMALS_BUFFER);
        gl.vertexAttribPointer(VERTEX_NORMAL_ATTRIB_LOC, CUBE_VERTEX_NORMALS_BUFFER.itemSize, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, CUBE_TEXTURE_COORDS_BUFFER);
        gl.vertexAttribPointer(VERTEX_TEXTURE_ATTRIB_LOC, CUBE_TEXTURE_COORDS_BUFFER.itemSize, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, CUBE_VERTEX_INDEX_BUFFER);

        // Draw Front of Satellite
        gl.bindTexture(gl.TEXTURE_2D, arguments[1]);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        // Draw Rest of Satellite
        gl.bindTexture(gl.TEXTURE_2D, arguments[1]);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 12);

        gl.bindTexture(gl.TEXTURE_2D, arguments[1]);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 24);

        gl.bindTexture(gl.TEXTURE_2D, arguments[0]);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 36);

        gl.bindTexture(gl.TEXTURE_2D, arguments[1]);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 48);

        gl.bindTexture(gl.TEXTURE_2D, arguments[1]);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 60);
    };

    /**
     * Interaction Handlers.
     */
    
    /** Function called when the mouse moves. */
    var onMouseMove = function (e) {
        if (drag === 0) return;
        if (e.altKey) {
            Trans.x = (e.clientX - xOffs) / 50;
        }
        if (e.shiftKey) {
            Trans.y = -(e.clientY - yOffs) / 50;
        }
        if (!e.altKey && !e.shiftKey) {
            Rot.y = - xOffs + e.clientX;
            Rot.x = - yOffs + e.clientY;
        }
        xOffs = e.clientX;
        yOffs = e.clientY;
        e.preventDefault();
    };

    /** Function called when the mouse is pressed down. */
    var onMouseDown = function (e) {
        drag = 1;
        xOffs = e.clientX;
        yOffs = e.clientY;
    };

    /** Function called when the mouse is released. */
    var onMouseUp = function () {
        drag = 0;
    };

    /** Function called when the scroll is used. */
    var wheelHandler = function (e) {
        if (e.altKey)
            Trans.x = e.wheelDeltaY / 1000;
        if (e.ctrlKey)
            Trans.y = e.wheelDeltaY / 1000;
        if (e.shiftKey)
            Trans.z = (e.wheelDeltaY) / 1000;
        e.preventDefault();
    };


    var handleKeyPresses = function () {
        // Arrow Up, increase satellite radius.
        if (pressedKeys[38]) {
            Satellite.radius.pos += 0.1;
        }
        // Arrow Down, decrease satellite radius.
        if (pressedKeys[40]) {
            if (Satellite.radius.pos >= Satellite.radius.min)
                Satellite.radius.pos -= 0.1;
        }
        // Arrow Left, increase satellite speed.
        if (pressedKeys[39]) {
            if (Satellite.orbit.time > Satellite.orbit.max)
                Satellite.orbit.time -= 10;
        }
        // Arrow Right, decrease satellite speed.
        if (pressedKeys[37]) {
            if (Satellite.orbit.time < Satellite.orbit.min)
                Satellite.orbit.time += 5;
        }
    };

    /** Function called when a key is released. */
    var onKeyUp = function (e) {
        pressedKeys[e.keyCode] = false;
    };

    /** Function called when a key is pressed. */
    var onKeyDown = function (e) {
        pressedKeys[e.keyCode] = true;
    };

    /**
     * Context Handlers.
     */
    
    var handleContextLost = function () {};
    var handleContextRestored = function () {};

    window.addEventListener('load', main, false);

}());