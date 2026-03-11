"use client";

import { useEffect, useState } from "react";
import { publicApiFetch } from "./api";

const EMPTY_MEDIA_OVERRIDES = {
  drivers: {},
  teams: {},
  races: {}
};

let mediaOverridesCache = null;
let mediaOverridesRequest = null;

function normalizeMediaOverrides(payload) {
  return {
    drivers: payload?.drivers && typeof payload.drivers === "object" ? payload.drivers : {},
    teams: payload?.teams && typeof payload.teams === "object" ? payload.teams : {},
    races: payload?.races && typeof payload.races === "object" ? payload.races : {}
  };
}

async function loadMediaOverrides() {
  if (mediaOverridesCache) return mediaOverridesCache;
  if (!mediaOverridesRequest) {
    mediaOverridesRequest = publicApiFetch("/f1/media-overrides")
      .then((payload) => {
        mediaOverridesCache = normalizeMediaOverrides(payload);
        return mediaOverridesCache;
      })
      .catch(() => EMPTY_MEDIA_OVERRIDES)
      .finally(() => {
        mediaOverridesRequest = null;
      });
  }

  return mediaOverridesRequest;
}

export function invalidateF1MediaOverridesCache() {
  mediaOverridesCache = null;
  mediaOverridesRequest = null;
}

export function useF1MediaOverrides() {
  const [overrides, setOverrides] = useState(mediaOverridesCache || EMPTY_MEDIA_OVERRIDES);

  useEffect(() => {
    let active = true;

    loadMediaOverrides().then((payload) => {
      if (!active) return;
      setOverrides(payload || EMPTY_MEDIA_OVERRIDES);
    });

    return () => {
      active = false;
    };
  }, []);

  return overrides;
}