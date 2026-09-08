export const rotate3D = (x: number, y: number, z: number, yaw: number, pitch: number) => {
        // Yaw (around Y axis)
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;

        // Pitch (around X axis)
        const cosX = Math.cos(pitch);
        const sinX = Math.sin(pitch);
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        return { x: x1, y: y2, z: z2 };
    };

export const getGlobeGridPaths = (yaw: number, pitch: number) => {
        const R = 140;
        const paths: { path: string; isFront: boolean }[] = [];

        const getPathString = (pts: { x: number; y: number }[]) => {
            if (pts.length === 0) return '';
            return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} ` +
                   pts.slice(1).map(p => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        };

        // Latitude circles
        const latDivisions = [-0.7, -0.35, 0, 0.35, 0.7];
        latDivisions.forEach(latVal => {
            const y = latVal * R;
            const radiusAtY = Math.sqrt(Math.max(0, R * R - y * y));

            const segments: { pts: { x: number; y: number }[]; isFront: boolean }[] = [];
            let currentSegment: { x: number; y: number }[] = [];
            let currentIsFront: boolean | null = null;

            const steps = 64;
            for (let j = 0; j <= steps; j++) {
                const theta = (j / steps) * 2 * Math.PI;
                const px = Math.cos(theta) * radiusAtY;
                const pz = Math.sin(theta) * radiusAtY;

                const rot = rotate3D(px, y, pz, yaw, pitch);
                const isFront = rot.z >= -10;

                const screenPt = { x: 300 + rot.x, y: 200 + rot.y };

                if (currentIsFront === null) {
                    currentIsFront = isFront;
                    currentSegment.push(screenPt);
                } else if (currentIsFront === isFront) {
                    currentSegment.push(screenPt);
                } else {
                    currentSegment.push(screenPt);
                    segments.push({ pts: currentSegment, isFront: currentIsFront });
                    currentSegment = [screenPt];
                    currentIsFront = isFront;
                }
            }
            if (currentSegment.length > 0) {
                segments.push({ pts: currentSegment, isFront: !!currentIsFront });
            }
            segments.forEach(s => paths.push({ path: getPathString(s.pts), isFront: s.isFront }));
        });

        // Longitude meridians
        const lats = [-60, -30, 0, 30, 60];
        lats.forEach(lat => {
            const latRad = (lat * Math.PI) / 180;
            const r = Math.cos(latRad) * R;
            const y = Math.sin(latRad) * R;

            const segments: { pts: { x: number; y: number }[]; isFront: boolean }[] = [];
            let currentSegment: { x: number; y: number }[] = [];
            let currentIsFront: boolean | null = null;

            const steps = 48;
            for (let i = 0; i <= steps; i++) {
                const lonRad = (i / steps) * 2 * Math.PI;
                const x = Math.cos(lonRad) * r;
                const z = Math.sin(lonRad) * r;

                const rot = rotate3D(x, y, z, yaw, pitch);
                const isFront = rot.z >= 0;
                const pt = { x: 300 + rot.x, y: 200 + rot.y };

                if (currentIsFront === null) {
                    currentIsFront = isFront;
                    currentSegment.push(pt);
                } else if (currentIsFront === isFront) {
                    currentSegment.push(pt);
                } else {
                    segments.push({ pts: currentSegment, isFront: currentIsFront });
                    currentIsFront = isFront;
                    currentSegment = [pt];
                }
            }
            if (currentSegment.length > 0) {
                segments.push({ pts: currentSegment, isFront: !!currentIsFront });
            }
            segments.forEach(s => paths.push({ path: getPathString(s.pts), isFront: s.isFront }));
        });

        return paths;
    };
