import {
  CAMERA_HEIGHT_DEFAULT,
  CAMERA_TILT_RAD_DEFAULT,
  CAMERA_YAW_RAD_DEFAULT,
  CAMERA_VIEW_HEIGHT_DEFAULT,
  CAMERA_FOV_DEFAULT,
} from "../../util/constants.js";

/**
 * Mutable, live-tunable camera parameters shared by every CameraController.
 * A plain object (rather than frozen constants) so the debug panel can
 * bind directly to its fields and edit them at runtime.
 */
export const cameraSettings = {
  heightMeters: CAMERA_HEIGHT_DEFAULT,
  tiltRad: CAMERA_TILT_RAD_DEFAULT,
  yawRad: CAMERA_YAW_RAD_DEFAULT,
  orthographicViewHeight: CAMERA_VIEW_HEIGHT_DEFAULT,
  perspectiveFovDeg: CAMERA_FOV_DEFAULT,
};
