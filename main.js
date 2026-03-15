/**
 * 3Dボクセル・ダンジョンゲーム - フェーズ1
 * 軽量化（MeshBasicMaterial, InstancedMesh）を意識したベースシステム
 */

import * as THREE from 'three';

// --- 定数 ---
const BLOCK_SIZE = 1.0;
const PLAYER_SIZE = 0.8;
const GRAVITY = -0.015;
const JUMP_STRENGTH = 0.35;
const MOVE_SPEED = 0.12;

// マップデータ（1: 壁, 0: 床）
const MAP_DATA = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1],
    [1, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1],
    [1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1],
    [1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

class Game {
    constructor() {
        this.initScene();
        this.initMap();
        this.initPlayer();
        this.initControls();
        this.animate();
    }

    /**
     * Three.jsの基本セットアップ
     */
    initScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // スカイブルー

        this.camera = new THREE.PerspectiveCamera(
            75, window.innerWidth / window.innerHeight, 0.1, 1000
        );

        this.renderer = new THREE.WebGLRenderer({ antialias: false });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        document.body.appendChild(this.renderer.domElement);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    /**
     * マップ生成
     */
    initMap() {
        this.blocks = [];
        const wallGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
        const floorGeometry = new THREE.BoxGeometry(BLOCK_SIZE, 0.2, BLOCK_SIZE);
        const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x8b4513 });
        const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x32cd32 });

        let wallCount = 0;
        let floorCount = 0;
        MAP_DATA.forEach(row => row.forEach(val => {
            if (val === 1) wallCount++;
            else floorCount++;
        }));

        this.wallMesh = new THREE.InstancedMesh(wallGeometry, wallMaterial, wallCount);
        this.floorMesh = new THREE.InstancedMesh(floorGeometry, floorMaterial, floorCount);
        
        let wallIdx = 0;
        let floorIdx = 0;
        const dummy = new THREE.Object3D();

        MAP_DATA.forEach((row, z) => {
            row.forEach((type, x) => {
                this.createBlock(x, 0, z, 0, dummy, this.floorMesh, floorIdx++);
                if (type === 1) {
                    this.createBlock(x, BLOCK_SIZE, z, 1, dummy, this.wallMesh, wallIdx++);
                    this.blocks.push({ x, y: BLOCK_SIZE, z });
                }
            });
        });

        this.scene.add(this.wallMesh);
        this.scene.add(this.floorMesh);
    }

    createBlock(x, y, z, type, dummy, instancedMesh, index) {
        dummy.position.set(x * BLOCK_SIZE, y, z * BLOCK_SIZE);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(index, dummy.matrix);
    }

    initPlayer() {
        // プレイヤーのグループ（本体と顔をまとめる）
        this.player = new THREE.Group();

        // プレイヤー本体（青いキューブ）
        const geometry = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
        const material = new THREE.MeshBasicMaterial({ color: 0x0000ff });
        const body = new THREE.Mesh(geometry, material);
        this.player.add(body);

        // 目（顔の方向をわかりやすくするための黒い小さなキューブ）
        const eyeGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.1);
        const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 }); // 黒
        
        const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        // Three.js の lookAt はローカルの +Z 軸をターゲットに向けるため、目は +Z 側に配置する
        leftEye.position.set(-0.2, 0.2, PLAYER_SIZE / 2 + 0.05); 
        this.player.add(leftEye);

        const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
        rightEye.position.set(0.2, 0.2, PLAYER_SIZE / 2 + 0.05);
        this.player.add(rightEye);

        this.player.position.set(1, 1, 1);
        this.scene.add(this.player);

        this.velocity = new THREE.Vector3();
        this.isGrounded = false;
    }

    initControls() {
        this.keys = {};
        window.addEventListener('keydown', (e) => this.keys[e.code] = true);
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);
    }

    checkCollision(nextPos) {
        const pSize = PLAYER_SIZE / 2;

        // --- マップ境界外への移動を制限 ---
        const mapMinX = -BLOCK_SIZE / 2;
        const mapMaxX = (MAP_DATA[0].length - 1) * BLOCK_SIZE + BLOCK_SIZE / 2;
        const mapMinZ = -BLOCK_SIZE / 2;
        const mapMaxZ = (MAP_DATA.length - 1) * BLOCK_SIZE + BLOCK_SIZE / 2;

        if (nextPos.x - pSize < mapMinX || nextPos.x + pSize > mapMaxX ||
            nextPos.z - pSize < mapMinZ || nextPos.z + pSize > mapMaxZ) {
            return true; // マップ外は衝突として扱う
        }

        for (const block of this.blocks) {
            const minX = block.x * BLOCK_SIZE - BLOCK_SIZE / 2;
            const maxX = block.x * BLOCK_SIZE + BLOCK_SIZE / 2;
            const minY = block.y - BLOCK_SIZE / 2;
            const maxY = block.y + BLOCK_SIZE / 2;
            const minZ = block.z * BLOCK_SIZE - BLOCK_SIZE / 2;
            const maxZ = block.z * BLOCK_SIZE + BLOCK_SIZE / 2;

            if (nextPos.x + pSize > minX && nextPos.x - pSize < maxX &&
                nextPos.y + pSize > minY && nextPos.y - pSize < maxY &&
                nextPos.z + pSize > minZ && nextPos.z - pSize < maxZ) {
                return true;
            }
        }
        return false;
    }

    update() {
        // --- 移動処理 ---
        // 標準的な方向定義（W/↑=前進, S/↓=後退, D/→=右, A/←=左）
        const moveForward = (this.keys['KeyW'] || this.keys['ArrowUp'] ? 1 : 0) - (this.keys['KeyS'] || this.keys['ArrowDown'] ? 1 : 0);
        const moveRight = (this.keys['KeyD'] || this.keys['ArrowRight'] ? 1 : 0) - (this.keys['KeyA'] || this.keys['ArrowLeft'] ? 1 : 0);
        
        if (moveForward !== 0 || moveRight !== 0) {
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();

            const right = new THREE.Vector3();
            right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

            const moveVec = new THREE.Vector3()
                .addScaledVector(forward, moveForward)
                .addScaledVector(right, moveRight)
                .normalize();
            
            // プレイヤーを進行方向に向かせる
            // 現在地から moveVec を足した位置を見るようにする
            const lookTarget = this.player.position.clone().add(moveVec);
            this.player.lookAt(lookTarget);

            const nextX = this.player.position.clone().add(new THREE.Vector3(moveVec.x * MOVE_SPEED, 0, 0));
            if (!this.checkCollision(nextX)) this.player.position.x = nextX.x;
            
            const nextZ = this.player.position.clone().add(new THREE.Vector3(0, 0, moveVec.z * MOVE_SPEED));
            if (!this.checkCollision(nextZ)) this.player.position.z = nextZ.z;
        }

        // --- 重力とジャンプ ---
        this.velocity.y += GRAVITY;
        const nextY = this.player.position.clone().add(new THREE.Vector3(0, this.velocity.y, 0));
        
        if (nextY.y < 0.5) {
            this.player.position.y = 0.5;
            this.velocity.y = 0;
            this.isGrounded = true;
        } else {
            if (this.checkCollision(nextY)) this.velocity.y = 0;
            else {
                this.player.position.y = nextY.y;
                this.isGrounded = false;
            }
        }

        if (this.isGrounded && this.keys['Space']) {
            this.velocity.y = JUMP_STRENGTH;
            this.isGrounded = false;
        }

        // --- カメラ追従 ---
        const camDist = 5;
        const camHeight = 4;
        const targetPos = new THREE.Vector3(
            this.player.position.x,
            this.player.position.y + camHeight,
            this.player.position.z + camDist
        );
        this.camera.position.lerp(targetPos, 0.1);
        this.camera.lookAt(this.player.position);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.update();
        this.renderer.render(this.scene, this.camera);
    }
}

new Game();
