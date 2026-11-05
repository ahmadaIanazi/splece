import React from "react";
import {
  UserRound,
  MapPin,
  Package,
  Palette,
  Film,
  Images,
  AudioLines,
} from "lucide-react";
import { assetTypes } from "../shared/library-organization.mjs";
export const assetTypeIcons = {
  character: UserRound,
  location: MapPin,
  prop: Package,
  style: Palette,
  footage: Film,
  image: Images,
  audio: AudioLines,
};
export function AssetTypePicker({ onChoose }) {
  return (
    <div className="asset-type-picker" aria-label="Choose asset type">
      {assetTypes.map((type) => {
        const Icon = assetTypeIcons[type.id];
        return (
          <button key={type.id} type="button" onClick={() => onChoose(type.id)}>
            <Icon size={23} />
            <span>
              <b>{type.name}</b>
              <small>{type.hint}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
