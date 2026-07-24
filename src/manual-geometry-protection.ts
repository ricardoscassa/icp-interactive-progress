namespace ICPDrawingLab {
  const updateRoomBeforeManualGeometryProtection = EditorStore.prototype.updateRoom;

  EditorStore.prototype.updateRoom = function updateRoomWithManualGeometryProtection(
    this: EditorStore,
    roomId: string,
    mutator: (room: RoomShape) => void,
    recordHistory = true,
  ): void {
    updateRoomBeforeManualGeometryProtection.call(
      this,
      roomId,
      (room) => {
        const pointsBefore = JSON.stringify(room.points);
        mutator(room);
        if (pointsBefore !== JSON.stringify(room.points) && room.reviewStatus === "unreviewed") {
          room.reviewStatus = "manual";
        }
      },
      recordHistory,
    );
  };
}
