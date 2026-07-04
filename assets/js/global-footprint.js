(function () {
  "use strict";

  var CONFIG = {
    seed: 20260704,
    totalPoints: 1500,
    pointMultiplier: 10,
    primaryColor: "#00c8ff",
    goldColor: "#ffc247",
    roseColor: "#ff4fa3"
  };

  var HUBS = [
    { name: "Guangzhou", region: "Guangdong", lat: 23.1291, lng: 113.2644, color: CONFIG.goldColor },
    { name: "Xiamen", region: "Fujian", lat: 24.4798, lng: 118.0894, color: CONFIG.primaryColor },
    { name: "Hong Kong", region: "Hong Kong", lat: 22.3193, lng: 114.1694, color: CONFIG.roseColor },
    { name: "Singapore", region: "Singapore", lat: 1.3521, lng: 103.8198, color: "#20dfb8" }
  ];

  var DISTRIBUTION = [
    {
      key: "Guangdong",
      count: 30,
      color: CONFIG.goldColor,
      radius: 1.45,
      centers: [
        ["Guangzhou", 23.1291, 113.2644],
        ["Shenzhen", 22.5431, 114.0579],
        ["Foshan", 23.0215, 113.1214],
        ["Dongguan", 23.0207, 113.7518]
      ]
    },
    {
      key: "Fujian",
      count: 18,
      color: CONFIG.primaryColor,
      radius: 1.35,
      centers: [
        ["Xiamen", 24.4798, 118.0894],
        ["Fuzhou", 26.0745, 119.2965],
        ["Quanzhou", 24.8741, 118.6757]
      ]
    },
    {
      key: "Hong Kong",
      count: 16,
      color: CONFIG.roseColor,
      radius: 0.28,
      centers: [["Hong Kong", 22.3193, 114.1694]]
    },
    {
      key: "Singapore",
      count: 22,
      color: "#20dfb8",
      radius: 0.22,
      centers: [["Singapore", 1.3521, 103.8198]]
    },
    {
      key: "Other Mainland China",
      count: 20,
      color: "#38a7ff",
      radius: 1.2,
      centers: [
        ["Beijing", 39.9042, 116.4074],
        ["Shanghai", 31.2304, 121.4737],
        ["Hangzhou", 30.2741, 120.1551],
        ["Nanjing", 32.0603, 118.7969],
        ["Chengdu", 30.5728, 104.0668],
        ["Wuhan", 30.5928, 114.3055],
        ["Xi'an", 34.3416, 108.9398],
        ["Chongqing", 29.563, 106.5516]
      ]
    },
    {
      key: "East & Southeast Asia",
      count: 12,
      color: "#00b7ff",
      radius: 1.0,
      centers: [
        ["Tokyo", 35.6762, 139.6503],
        ["Seoul", 37.5665, 126.978],
        ["Taipei", 25.033, 121.5654],
        ["Bangkok", 13.7563, 100.5018],
        ["Kuala Lumpur", 3.139, 101.6869],
        ["Hanoi", 21.0278, 105.8342],
        ["Manila", 14.5995, 120.9842],
        ["Jakarta", -6.2088, 106.8456]
      ]
    },
    {
      key: "North America",
      count: 12,
      color: "#5d80ff",
      radius: 1.3,
      centers: [
        ["San Francisco", 37.7749, -122.4194],
        ["Los Angeles", 34.0522, -118.2437],
        ["Seattle", 47.6062, -122.3321],
        ["Boston", 42.3601, -71.0589],
        ["New York", 40.7128, -74.006],
        ["Toronto", 43.6532, -79.3832],
        ["Vancouver", 49.2827, -123.1207]
      ]
    },
    {
      key: "Europe",
      count: 10,
      color: "#a46bff",
      radius: 1.15,
      centers: [
        ["London", 51.5074, -0.1278],
        ["Paris", 48.8566, 2.3522],
        ["Berlin", 52.52, 13.405],
        ["Zurich", 47.3769, 8.5417],
        ["Amsterdam", 52.3676, 4.9041],
        ["Stockholm", 59.3293, 18.0686]
      ]
    },
    {
      key: "Oceania",
      count: 4,
      color: "#20dfb8",
      radius: 1.0,
      centers: [
        ["Sydney", -33.8688, 151.2093],
        ["Melbourne", -37.8136, 144.9631],
        ["Auckland", -36.8509, 174.7645],
        ["Brisbane", -27.4698, 153.0251]
      ]
    },
    {
      key: "South Asia & Middle East",
      count: 4,
      color: "#ffaf35",
      radius: 1.0,
      centers: [
        ["Delhi", 28.6139, 77.209],
        ["Mumbai", 19.076, 72.8777],
        ["Dubai", 25.2048, 55.2708],
        ["Doha", 25.2854, 51.531]
      ]
    },
    {
      key: "Latin America & Africa",
      count: 2,
      color: "#ff6b59",
      radius: 1.25,
      centers: [
        ["Sao Paulo", -23.5558, -46.6396],
        ["Cape Town", -33.9249, 18.4241]
      ]
    }
  ];

  function makeRandom(seed) {
    var state = seed >>> 0;
    return function () {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function jitter(random, radius) {
    var angle = random() * Math.PI * 2;
    var distance = Math.sqrt(random()) * radius;
    return {
      lat: Math.sin(angle) * distance,
      lng: Math.cos(angle) * distance
    };
  }

  function clampLat(value) {
    return Math.max(-82, Math.min(82, value));
  }

  function buildPoints() {
    var random = makeRandom(CONFIG.seed);
    var points = [];

    DISTRIBUTION.forEach(function (bucket) {
      var count = bucket.count * CONFIG.pointMultiplier;
      for (var i = 0; i < count; i += 1) {
        var center = bucket.centers[Math.floor(random() * bucket.centers.length)];
        var offset = jitter(random, bucket.radius);
        points.push({
          id: bucket.key + "-" + i,
          city: center[0],
          region: bucket.key,
          lat: clampLat(center[1] + offset.lat),
          lng: center[2] + offset.lng,
          color: bucket.color,
          radius: 0.095 + random() * 0.11,
          altitude: 0.014 + random() * 0.028,
          intensity: 0.42 + random() * 0.58
        });
      }
    });

    return points;
  }

  function buildArcs(points) {
    var targets = [
      "Beijing", "Shanghai", "Hangzhou", "Tokyo", "Seoul", "Taipei", "Bangkok",
      "Kuala Lumpur", "Hanoi", "San Francisco", "Los Angeles", "Seattle",
      "Boston", "New York", "Toronto", "London", "Paris", "Berlin", "Zurich",
      "Amsterdam", "Sydney", "Melbourne", "Delhi", "Dubai", "Doha", "Sao Paulo",
      "Cape Town", "Auckland"
    ];

    return targets.map(function (city, index) {
      var target = points.find(function (point) {
        return point.city === city;
      }) || points[(index * 7) % points.length];
      var hub = HUBS[index % HUBS.length];
      return {
        startLat: hub.lat,
        startLng: hub.lng,
        endLat: target.lat,
        endLng: target.lng,
        color: [hub.color, target.color],
        label: hub.name + " -> " + target.city,
        altitude: 0.27 + (index % 5) * 0.055,
        stroke: 0.76 + (index % 3) * 0.22,
        dashSeed: (index * 0.071) % 1
      };
    });
  }

  function buildRings() {
    return HUBS.map(function (hub, index) {
      return {
        lat: hub.lat,
        lng: hub.lng,
        name: hub.name,
        color: hub.color,
        maxRadius: index === 3 ? 5.8 : 5.1,
        speed: 0.86 + index * 0.1,
        repeat: 1180 + index * 150
      };
    });
  }

  function buildHubHotspots() {
    return HUBS.map(function (hub) {
      return {
        id: "hub-" + hub.name,
        city: hub.name,
        region: hub.region,
        lat: hub.lat,
        lng: hub.lng,
        color: hub.color,
        radius: 0.34,
        altitude: 0.055,
        intensity: 1,
        isHub: true
      };
    });
  }

  function hasWebGL() {
    try {
      var canvas = document.createElement("canvas");
      return Boolean(window.WebGLRenderingContext && (
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
      ));
    } catch (error) {
      return false;
    }
  }

  function showFallback(root, fallback) {
    if (root) {
      root.style.display = "none";
    }
    if (fallback) {
      fallback.classList.add("is-visible");
    }
  }

  function pointLabel(point) {
    return [
      '<div class="globe-tooltip">',
      "<b>" + point.city + "</b><br>",
      point.region + "<br>",
      point.isHub ? "Key footprint hub" : "Global footprint",
      "</div>"
    ].join("");
  }

  function geoDistanceDegrees(aLat, aLng, bLat, bLng) {
    var toRad = Math.PI / 180;
    var lat1 = aLat * toRad;
    var lat2 = bLat * toRad;
    var dLat = (bLat - aLat) * toRad;
    var dLng = (bLng - aLng) * toRad;
    var sinLat = Math.sin(dLat / 2);
    var sinLng = Math.sin(dLng / 2);
    var a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))) / toRad;
  }

  function findNearestFootprint(coords, candidates) {
    if (!coords || coords.lat === undefined || coords.lng === undefined) {
      return null;
    }

    var best = null;
    var bestDistance = Infinity;
    candidates.forEach(function (point) {
      var distance = geoDistanceDegrees(coords.lat, coords.lng, point.lat, point.lng);
      var threshold = point.isHub ? 9.0 : 4.2;
      if (distance < threshold && distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    });

    return best;
  }

  function setupManualTooltip(root, stage, globe, candidates) {
    if (!root || !stage || typeof globe.toGlobeCoords !== "function") {
      return;
    }

    var tooltip = document.createElement("div");
    tooltip.className = "globe-manual-tooltip";
    tooltip.setAttribute("aria-hidden", "true");
    stage.appendChild(tooltip);

    var pendingEvent = null;
    var raf = 0;

    function hideTooltip() {
      tooltip.classList.remove("is-visible");
      tooltip.setAttribute("aria-hidden", "true");
      root.classList.remove("is-hovering-point");
    }

    function updateTooltip() {
      raf = 0;
      if (!pendingEvent) {
        hideTooltip();
        return;
      }

      var stageRect = stage.getBoundingClientRect();
      var x = pendingEvent.clientX - stageRect.left;
      var y = pendingEvent.clientY - stageRect.top;
      var coords = globe.toGlobeCoords(x, y);
      var nearest = findNearestFootprint(coords, candidates);

      if (!nearest) {
        hideTooltip();
        return;
      }

      tooltip.innerHTML = pointLabel(nearest);
      tooltip.classList.add("is-visible");
      tooltip.setAttribute("aria-hidden", "false");
      root.classList.add("is-hovering-point");

      var tooltipWidth = tooltip.offsetWidth || 150;
      var tooltipHeight = tooltip.offsetHeight || 74;
      var left = Math.min(stage.clientWidth - tooltipWidth - 12, Math.max(12, x + 16));
      var top = Math.min(stage.clientHeight - tooltipHeight - 12, Math.max(12, y + 12));
      tooltip.style.left = left + "px";
      tooltip.style.top = top + "px";
    }

    root.addEventListener("mousemove", function (event) {
      pendingEvent = event;
      if (!raf) {
        raf = window.requestAnimationFrame(updateTooltip);
      }
    });

    root.addEventListener("mouseleave", function () {
      pendingEvent = null;
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
      hideTooltip();
    });
  }

  function initGlobe() {
    var root = document.getElementById("global-footprint-globe");
    var fallback = document.getElementById("global-footprint-fallback");
    if (!root) {
      return;
    }

    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!hasWebGL() || typeof window.Globe !== "function") {
      showFallback(root, fallback);
      return;
    }

    var points = buildPoints();
    var hubHotspots = buildHubHotspots();
    var interactivePoints = points.concat(hubHotspots);
    var arcs = buildArcs(points);
    var rings = buildRings();
    var labels = HUBS.map(function (hub) {
      return {
        lat: hub.lat,
        lng: hub.lng,
        text: hub.name,
        region: hub.region,
        color: hub.color
      };
    });

    var globe = window.Globe({ animateIn: !reduceMotion })(root)
      .backgroundColor("rgba(0,0,0,0)")
      .globeImageUrl("https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg")
      .bumpImageUrl("https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png")
      .showAtmosphere(true)
      .atmosphereColor("#8bbdff")
      .atmosphereAltitude(0.18)
      .pointsData(interactivePoints)
      .pointLat("lat")
      .pointLng("lng")
      .pointAltitude("altitude")
      .pointRadius("radius")
      .pointColor(function (point) {
        return point.color;
      })
      .pointResolution(14)
      .pointsMerge(false)
      .arcsData(arcs)
      .arcStartLat("startLat")
      .arcStartLng("startLng")
      .arcEndLat("endLat")
      .arcEndLng("endLng")
      .arcAltitude("altitude")
      .arcStroke("stroke")
      .arcColor("color")
      .arcDashLength(reduceMotion ? 1 : 0.48)
      .arcDashGap(reduceMotion ? 0 : 0.34)
      .arcDashInitialGap("dashSeed")
      .arcDashAnimateTime(reduceMotion ? 0 : 2600)
      .ringsData(rings)
      .ringLat("lat")
      .ringLng("lng")
      .ringColor(function (ring) {
        return function (t) {
          var alpha = Math.max(0, 0.82 - t) * 0.98;
          return ring.color + Math.round(alpha * 255).toString(16).padStart(2, "0");
        };
      })
      .ringMaxRadius("maxRadius")
      .ringPropagationSpeed("speed")
      .ringRepeatPeriod(reduceMotion ? 0 : "repeat")
      .labelsData(labels)
      .labelLat("lat")
      .labelLng("lng")
      .labelText("text")
      .labelColor(function (label) {
        return label.color;
      })
      .labelSize(0.82)
      .labelDotRadius(0.46)
      .labelAltitude(0.06)
      .labelResolution(2)
      .enablePointerInteraction(false);

    globe.pointOfView({ lat: 21, lng: 107, altitude: 2.22 }, reduceMotion ? 0 : 1200);

    var controls = globe.controls();
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.36;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = true;
    controls.minDistance = 180;
    controls.maxDistance = 520;

    setupManualTooltip(root, root.closest(".global-stage"), globe, interactivePoints);

    function resize() {
      var stage = root.closest(".global-stage") || root.parentElement || root;
      var panel = root.closest(".global-footprint-panel");
      var content = root.closest(".content");
      var rect = stage.getBoundingClientRect();
      var contentRect = content ? content.getBoundingClientRect() : rect;
      var panelStyle = panel ? window.getComputedStyle(panel) : null;
      var panelPadding = panelStyle
        ? parseFloat(panelStyle.paddingLeft || 0) + parseFloat(panelStyle.paddingRight || 0)
        : 0;
      var contentBound = Math.max(280, contentRect.width - panelPadding - 2);
      var width = Math.max(280, Math.round(Math.min(rect.width || contentBound, contentBound)));
      var height = Math.max(300, Math.round(rect.height));
      stage.style.width = "100%";
      stage.style.maxWidth = "100%";
      root.style.width = "100%";
      root.style.maxWidth = "100%";
      root.style.height = "100%";
      root.style.overflow = "hidden";
      globe.width(width).height(height);
      var inner = root.firstElementChild;
      if (inner) {
        inner.style.width = "100%";
        inner.style.maxWidth = "100%";
        inner.style.height = "100%";
        inner.style.overflow = "hidden";
      }
      var canvas = root.querySelector("canvas");
      if (canvas) {
        canvas.style.width = "100%";
        canvas.style.maxWidth = "100%";
        canvas.style.height = "100%";
      }
    }

    resize();
    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(root.closest(".global-stage") || root);
    } else {
      window.addEventListener("resize", resize);
    }

    root.dataset.points = String(points.length);
    root.dataset.arcs = String(arcs.length);
    root.__globalFootprint = {
      globe: globe,
      points: points,
      hubHotspots: hubHotspots,
      labels: labels,
      arcs: arcs
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGlobe);
  } else {
    initGlobe();
  }
})();
