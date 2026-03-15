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

// 鬼（エネミー）用の定数
const ENEMY_SIZE = 0.8;
const ENEMY_SPEED_WANDER = 0.02; // 徘徊モードの速度
const ENEMY_SPEED_CHASE = 0.06;  // 突撃モードの速度
const CATCH_DISTANCE = 0.8;      // ゲームオーバーになる距離

// マップ生成用の定数
const MAP_WIDTH = 25;
const MAP_HEIGHT = 25;
const ROOM_COUNT = 5;

class Game {
    constructor() {
        this.generateRandomMap(MAP_WIDTH, MAP_HEIGHT, ROOM_COUNT);
        this.initScene();
        this.initMap();
        this.initPlayer();
        this.initEnemy();
        this.initControls();
        this.animate();
    }

    /**
     * BSP（2分木分割）を用いたダンジョンマップの生成
     */
    generateRandomMap(width, height) {
        this.mapWidth = width;
        this.mapHeight = height;
        // 初期状態はすべて壁(1)
        this.mapData = Array(height).fill(0).map(() => Array(width).fill(1));
        this.floorPositions = [];

        const MIN_ROOM_SIZE = 4;
        const MIN_PARTITION_SIZE = 8;

        class Partition {
            constructor(x, y, w, h) {
                this.x = x;
                this.y = y;
                this.w = w;
                this.h = h;
                this.left = null;
                this.right = null;
                this.room = null;
            }

            split() {
                if (this.left || this.right) return false; // 既に分割済み

                // 分割方向を決定（縦長なら横に、横長なら縦に分割しやすいようにする）
                let splitH = Math.random() > 0.5;
                if (this.w > this.h && this.w / this.h >= 1.25) splitH = false;
                else if (this.h > this.w && this.h / this.w >= 1.25) splitH = true;

                const max = (splitH ? this.h : this.w) - MIN_PARTITION_SIZE;
                if (max <= MIN_PARTITION_SIZE) return false; // 分割するには小さすぎる

                const splitAt = Math.floor(Math.random() * (max - MIN_PARTITION_SIZE)) + MIN_PARTITION_SIZE;

                if (splitH) {
                    this.left = new Partition(this.x, this.y, this.w, splitAt);
                    this.right = new Partition(this.x, this.y + splitAt, this.w, this.h - splitAt);
                } else {
                    this.left = new Partition(this.x, this.y, splitAt, this.h);
                    this.right = new Partition(this.x + splitAt, this.y, this.w - splitAt, this.h);
                }
                return true;
            }

            createRooms() {
                if (this.left || this.right) {
                    if (this.left) this.left.createRooms();
                    if (this.right) this.right.createRooms();
                } else {
                    // 区画内に部屋を作る
                    const roomW = Math.floor(Math.random() * (this.w - MIN_ROOM_SIZE)) + MIN_ROOM_SIZE - 1;
                    const roomH = Math.floor(Math.random() * (this.h - MIN_ROOM_SIZE)) + MIN_ROOM_SIZE - 1;
                    const roomX = Math.floor(Math.random() * (this.w - roomW - 1)) + 1;
                    const roomY = Math.floor(Math.random() * (this.h - roomH - 1)) + 1;
                    this.room = { x: this.x + roomX, y: this.y + roomY, w: roomW, h: roomH };
                }
            }

            getRoom() {
                if (this.room) return this.room;
                let lRoom = null, rRoom = null;
                if (this.left) lRoom = this.left.getRoom();
                if (this.right) rRoom = this.right.getRoom();
                if (!lRoom && !rRoom) return null;
                if (!lRoom) return rRoom;
                if (!rRoom) return lRoom;
                return Math.random() > 0.5 ? lRoom : rRoom;
            }
        }

        // 1. 区画の分割
        const root = new Partition(1, 1, width - 2, height - 2);
        const partitions = [root];
        let didSplit = true;
        while (didSplit) {
            didSplit = false;
            for (let i = 0; i < partitions.length; i++) {
                const p = partitions[i];
                if (!p.left && !p.right) {
                    if (p.w > MIN_PARTITION_SIZE * 2 || p.h > MIN_PARTITION_SIZE * 2 || Math.random() > 0.2) {
                        if (p.split()) {
                            partitions.push(p.left);
                            partitions.push(p.right);
                            didSplit = true;
                        }
                    }
                }
            }
        }

        // 2. 部屋の生成
        root.createRooms();

        // 3. マップ配列への書き込み（部屋）
        const writeRoom = (p) => {
            if (p.room) {
                for (let z = p.room.y; z < p.room.y + p.room.h; z++) {
                    for (let x = p.room.x; x < p.room.x + p.room.w; x++) {
                        this.mapData[z][x] = 0;
                    }
                }
            } else {
                if (p.left) writeRoom(p.left);
                if (p.right) writeRoom(p.right);
            }
        };
        writeRoom(root);

        // 4. 通路の生成
        const createHCorridor = (x1, x2, y) => {
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) this.mapData[y][x] = 0;
        };
        const createVCorridor = (y1, y2, x) => {
            for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) this.mapData[y][x] = 0;
        };

        const connectPartitions = (p) => {
            if (!p.left || !p.right) return;
            
            const roomA = p.left.getRoom();
            const roomB = p.right.getRoom();
            
            if (roomA && roomB) {
                const centerA = { x: Math.floor(roomA.x + roomA.w / 2), y: Math.floor(roomA.y + roomA.h / 2) };
                const centerB = { x: Math.floor(roomB.x + roomB.w / 2), y: Math.floor(roomB.y + roomB.h / 2) };
                
                // ランダムに横->縦 か 縦->横 で繋ぐ
                if (Math.random() > 0.5) {
                    createHCorridor(centerA.x, centerB.x, centerA.y);
                    createVCorridor(centerA.y, centerB.y, centerB.x);
                } else {
                    createVCorridor(centerA.y, centerB.y, centerA.x);
                    createHCorridor(centerA.x, centerB.x, centerB.y);
                }
            }
            
            connectPartitions(p.left);
            connectPartitions(p.right);
        };
        connectPartitions(root);

        // 5. 床の座標リスト化
        for (let z = 0; z < height; z++) {
            for (let x = 0; x < width; x++) {
                if (this.mapData[z][x] === 0) {
                    this.floorPositions.push(new THREE.Vector3(x * BLOCK_SIZE, 0, z * BLOCK_SIZE));
                }
            }
        }
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
        this.mapData.forEach(row => row.forEach(val => {
            if (val === 1) wallCount++;
            else floorCount++;
        }));

        this.wallMesh = new THREE.InstancedMesh(wallGeometry, wallMaterial, wallCount);
        this.floorMesh = new THREE.InstancedMesh(floorGeometry, floorMaterial, floorCount);
        
        let wallIdx = 0;
        let floorIdx = 0;
        const dummy = new THREE.Object3D();

        this.mapData.forEach((row, z) => {
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

    /**
     * ランダムな床の座標を取得する（指定座標から一定距離離すことも可能）
     */
    getSpawnPosition(minDistFrom = null, requireOpenSpace = true) {
        let pos;
        let attempts = 0;
        
        // 周囲8マスがすべて床である「安全な床」のリストを作成
        let safePositions = [];
        if (requireOpenSpace) {
            for (let z = 1; z < this.mapHeight - 1; z++) {
                for (let x = 1; x < this.mapWidth - 1; x++) {
                    if (this.mapData[z][x] === 0 &&
                        this.mapData[z-1][x] === 0 && this.mapData[z+1][x] === 0 &&
                        this.mapData[z][x-1] === 0 && this.mapData[z][x+1] === 0 &&
                        this.mapData[z-1][x-1] === 0 && this.mapData[z-1][x+1] === 0 &&
                        this.mapData[z+1][x-1] === 0 && this.mapData[z+1][x+1] === 0) {
                        safePositions.push(new THREE.Vector3(x * BLOCK_SIZE, 0, z * BLOCK_SIZE));
                    }
                }
            }
        }

        // 安全な床がない場合（細い通路しかない等）は、すべての床を候補にする
        const candidates = safePositions.length > 0 ? safePositions : this.floorPositions;

        do {
            const idx = Math.floor(Math.random() * candidates.length);
            pos = candidates[idx].clone();
            pos.y = 1; // 空中（ブロックの上）から落下させる
            attempts++;
        } while (minDistFrom && pos.distanceTo(minDistFrom) < 10 && attempts < 50);
        
        return pos;
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

        this.player.position.copy(this.getSpawnPosition());
        this.scene.add(this.player);

        this.velocity = new THREE.Vector3();
        this.isGrounded = false;
    }

    initEnemy() {
        const geometry = new THREE.BoxGeometry(ENEMY_SIZE, ENEMY_SIZE, ENEMY_SIZE);
        this.enemyMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // 赤
        this.enemy = new THREE.Mesh(geometry, this.enemyMaterial);
        
        // 初期位置（プレイヤーから離れた場所）
        this.enemy.position.copy(this.getSpawnPosition(this.player.position));
        this.scene.add(this.enemy);

        this.enemyVelocity = new THREE.Vector3();
        // 最初の進行方向をランダムに設定
        const angle = Math.random() * Math.PI * 2;
        this.enemyDirection = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
        
        // 視界判定用のRaycaster
        this.raycaster = new THREE.Raycaster();
    }

    initControls() {
        this.keys = {};
        window.addEventListener('keydown', (e) => this.keys[e.code] = true);
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);
    }

    checkCollision(nextPos, size = PLAYER_SIZE) {
        const pSize = size / 2;

        // --- マップ境界外への移動を制限 ---
        const mapMinX = -BLOCK_SIZE / 2;
        const mapMaxX = (this.mapWidth - 1) * BLOCK_SIZE + BLOCK_SIZE / 2;
        const mapMinZ = -BLOCK_SIZE / 2;
        const mapMaxZ = (this.mapHeight - 1) * BLOCK_SIZE + BLOCK_SIZE / 2;

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

    updateEnemy() {
        // --- 視界判定 (Raycaster) ---
        const toPlayer = new THREE.Vector3().subVectors(this.player.position, this.enemy.position);
        const distanceToPlayer = toPlayer.length();
        const direction = toPlayer.clone().normalize();

        // Raycasterの設定（鬼の中心からプレイヤーの方向へ）
        const rayOrigin = this.enemy.position.clone();
        rayOrigin.y += 0.2; // 足元ではなく少し上から飛ばす
        this.raycaster.set(rayOrigin, direction);

        // 壁（this.wallMesh）との交差判定
        const intersects = this.raycaster.intersectObject(this.wallMesh);

        let canSeePlayer = true;
        if (intersects.length > 0) {
            // 壁までの距離がプレイヤーまでの距離より近い場合、視界が遮られている
            if (intersects[0].distance < distanceToPlayer) {
                canSeePlayer = false;
            }
        }

        let speed = 0;

        if (canSeePlayer) {
            // 【突撃モード】
            speed = ENEMY_SPEED_CHASE;
            this.enemyDirection.copy(direction);
            this.enemyDirection.y = 0; // 水平移動のみ
            this.enemyDirection.normalize();
            
            // 視覚的なフィードバック：色を点滅させる
            const time = Date.now();
            if (Math.floor(time / 200) % 2 === 0) {
                this.enemyMaterial.color.setHex(0xff4500); // オレンジレッド
            } else {
                this.enemyMaterial.color.setHex(0x8b0000); // ダークレッド
            }
        } else {
            // 【徘徊モード】
            speed = ENEMY_SPEED_WANDER;
            this.enemyMaterial.color.setHex(0xff0000); // 通常の赤
        }

        // X軸の移動と衝突判定（鬼用）
        const nextX = this.enemy.position.clone().add(new THREE.Vector3(this.enemyDirection.x * speed, 0, 0));
        if (!this.checkCollision(nextX, ENEMY_SIZE)) {
            this.enemy.position.x = nextX.x;
        } else if (!canSeePlayer) {
            // 徘徊中で壁にぶつかったらランダムに方向を変える（-90度〜90度）
            const angle = (Math.random() - 0.5) * Math.PI; 
            this.enemyDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle + Math.PI / 2).normalize();
        }

        // Z軸の移動と衝突判定（鬼用）
        const nextZ = this.enemy.position.clone().add(new THREE.Vector3(0, 0, this.enemyDirection.z * speed));
        if (!this.checkCollision(nextZ, ENEMY_SIZE)) {
            this.enemy.position.z = nextZ.z;
        } else if (!canSeePlayer) {
            // 徘徊中で壁にぶつかったらランダムに方向を変える
            const angle = (Math.random() - 0.5) * Math.PI;
            this.enemyDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle + Math.PI / 2).normalize();
        }

        // --- 重力処理（鬼用） ---
        this.enemyVelocity.y += GRAVITY;
        const nextY = this.enemy.position.clone().add(new THREE.Vector3(0, this.enemyVelocity.y, 0));
        if (nextY.y < 0.5) {
            this.enemy.position.y = 0.5;
            this.enemyVelocity.y = 0;
        }
    }

    resetGame() {
        // プレイヤーの位置をリセット
        this.player.position.set(1, 1, 1);
        this.velocity.set(0, 0, 0);

        // 鬼の位置をリセット
        this.enemy.position.set(10, 1, 9);
        this.enemyVelocity.set(0, 0, 0);
        this.enemyMaterial.color.setHex(0xff0000);
        
        // 入力状態をリセット
        this.keys = {};
    }

    update() {
        // --- 鬼のAI更新 ---
        this.updateEnemy();

        // --- ゲームオーバー判定 ---
        // プレイヤーと鬼の中心距離で判定
        const dist = this.player.position.distanceTo(this.enemy.position);
        if (dist < CATCH_DISTANCE) {
            alert("捕まった！ゲームオーバー！");
            this.resetGame();
            return; // 以降のフレーム更新をスキップ
        }

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
