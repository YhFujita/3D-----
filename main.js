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
// 将来的に高さを扱うための3Dグリッドとしても拡張可能な設計
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

        this.renderer = new THREE.WebGLRenderer({ antialias: false }); // 軽量化のためアンチエイリアスOFF
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 高DPI対応
        document.body.appendChild(this.renderer.domElement);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    /**
     * マップ生成
     * InstancedMeshを使用して大量のブロックを高速に描画
     */
    initMap() {
        this.blocks = []; // 衝突判定用の壁リスト
        
        const wallGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
        const floorGeometry = new THREE.BoxGeometry(BLOCK_SIZE, 0.2, BLOCK_SIZE); // 床は薄くして軽量化

        // 軽量化のため MeshBasicMaterial を使用（ライティング計算なし）
        const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x8b4513 }); // 茶色
        const floorMaterial = new THREE.MeshBasicMaterial({ color: 0x32cd32 }); // 緑色

        // 壁と床をそれぞれカウント
        let wallCount = 0;
        let floorCount = 0;
        MAP_DATA.forEach(row => row.forEach(val => {
            if (val === 1) wallCount++;
            else floorCount++;
        }));

        // InstancedMeshの作成
        this.wallMesh = new THREE.InstancedMesh(wallGeometry, wallMaterial, wallCount);
        this.floorMesh = new THREE.InstancedMesh(floorGeometry, floorMaterial, floorCount);
        
        let wallIdx = 0;
        let floorIdx = 0;
        const dummy = new THREE.Object3D();

        MAP_DATA.forEach((row, z) => {
            row.forEach((type, x) => {
                // 床は常に配置（高さ0に固定）
                this.createBlock(x, 0, z, 0, dummy, this.floorMesh, floorIdx++);
                
                if (type === 1) {
                    // 壁を配置（高さ1に配置）
                    this.createBlock(x, BLOCK_SIZE, z, 1, dummy, this.wallMesh, wallIdx++);
                    // 衝突判定用に保存
                    this.blocks.push({ x, y: BLOCK_SIZE, z });
                }
            });
        });

        this.scene.add(this.wallMesh);
        this.scene.add(this.floorMesh);
    }

    /**
     * ブロックを生成/配置する（将来の高低差を見据えた設計）
     */
    createBlock(x, y, z, type, dummy, instancedMesh, index) {
        dummy.position.set(x * BLOCK_SIZE, y, z * BLOCK_SIZE);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(index, dummy.matrix);
    }

    /**
     * プレイヤーの作成
     */
    initPlayer() {
        const geometry = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
        const material = new THREE.MeshBasicMaterial({ color: 0x0000ff }); // 青色
        this.player = new THREE.Mesh(geometry, material);
        
        // 初期位置（床のある場所を探す）
        this.player.position.set(1, 1, 1);
        this.scene.add(this.player);

        // 物理データ
        this.velocity = new THREE.Vector3();
        this.isGrounded = false;
    }

    /**
     * キーボード入力の管理
     */
    initControls() {
        this.keys = {};
        window.addEventListener('keydown', (e) => this.keys[e.code] = true);
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);
    }

    /**
     * AABBによる衝突判定
     * 指定された次位置 (nextPos) が壁と重なるかチェック
     */
    checkCollision(nextPos) {
        const padding = (BLOCK_SIZE - PLAYER_SIZE) / 2 + 0.05; // 余裕を持たせる
        const pSize = PLAYER_SIZE / 2;

        for (const block of this.blocks) {
            // 壁の範囲 (x, y, z)
            const minX = block.x * BLOCK_SIZE - BLOCK_SIZE / 2;
            const maxX = block.x * BLOCK_SIZE + BLOCK_SIZE / 2;
            const minY = block.y - BLOCK_SIZE / 2;
            const maxY = block.y + BLOCK_SIZE / 2;
            const minZ = block.z * BLOCK_SIZE - BLOCK_SIZE / 2;
            const maxZ = block.z * BLOCK_SIZE + BLOCK_SIZE / 2;

            // プレイヤーの次位置の範囲
            if (nextPos.x + pSize > minX && nextPos.x - pSize < maxX &&
                nextPos.y + pSize > minY && nextPos.y - pSize < maxY &&
                nextPos.z + pSize > minZ && nextPos.z - pSize < maxZ) {
                return true; // 衝突
            }
        }
        return false;
    }

    /**
     * フレーム更新
     */
    update() {
        // --- 移動処理 ---
        const moveX = (this.keys['KeyD'] || this.keys['ArrowRight'] ? 1 : 0) - (this.keys['KeyA'] || this.keys['ArrowLeft'] ? 1 : 0);
        const moveZ = (this.keys['KeyS'] || this.keys['ArrowDown'] ? 1 : 0) - (this.keys['KeyW'] || this.keys['ArrowUp'] ? 1 : 0);
        
        if (moveX !== 0 || moveZ !== 0) {
            // カメラの向きに基づく移動ベクトル計算（Y軸回転のみ考慮）
            const angle = Math.atan2(
                this.player.position.x - this.camera.position.x,
                this.player.position.z - this.camera.position.z
            );
            
            const direction = new THREE.Vector3(moveX, 0, moveZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).normalize();
            
            // X軸の移動と衝突判定
            const nextX = this.player.position.clone().add(new THREE.Vector3(direction.x * MOVE_SPEED, 0, 0));
            if (!this.checkCollision(nextX)) {
                this.player.position.x = nextX.x;
            }
            
            // Z軸の移動と衝突判定
            const nextZ = this.player.position.clone().add(new THREE.Vector3(0, 0, direction.z * MOVE_SPEED));
            if (!this.checkCollision(nextZ)) {
                this.player.position.z = nextZ.z;
            }
        }

        // --- 重力とジャンプ ---
        this.velocity.y += GRAVITY;
        const nextY = this.player.position.clone().add(new THREE.Vector3(0, this.velocity.y, 0));
        
        // 床との判定（簡易的にy=0.5を接地とする）
        if (nextY.y < 0.5) {
            this.player.position.y = 0.5;
            this.velocity.y = 0;
            this.isGrounded = true;
        } else {
            // 壁との垂直方向の衝突判定
            if (this.checkCollision(nextY)) {
                this.velocity.y = 0;
            } else {
                this.player.position.y = nextY.y;
                this.isGrounded = false;
            }
        }

        if (this.isGrounded && this.keys['Space']) {
            this.velocity.y = JUMP_STRENGTH;
            this.isGrounded = false;
        }

        // --- カメラ追従 (TPS) ---
        const camDist = 5;
        const camHeight = 4;
        const targetPos = new THREE.Vector3(
            this.player.position.x,
            this.player.position.y + camHeight,
            this.player.position.z + camDist
        );
        
        // Lerpで滑らかに追随
        this.camera.position.lerp(targetPos, 0.1);
        this.camera.lookAt(this.player.position);
    }

    /**
     * アニメーションループ
     */
    animate() {
        requestAnimationFrame(() => this.animate());
        this.update();
        this.renderer.render(this.scene, this.camera);
    }
}

// ゲーム開始
new Game();
